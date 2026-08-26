/**
 * DFE: coercion for native ClickHouse `JSON` sub-columns.
 *
 * A sub-path of a native `JSON` column has type `Dynamic`, and ClickHouse
 * refuses `Dynamic` almost everywhere a chart or filter needs it:
 *
 *   avg(Body.latency_ms)          -> code 43, illegal type Dynamic
 *   ... GROUP BY Body.user.name   -> code 44, not allowed in GROUP BY keys
 *   ... ORDER BY Body.latency_ms  -> code 44, not allowed in ORDER BY keys
 *   Body.user.name IN ('alice')   -> code 43, illegal type Dynamic
 *   Body['user']                  -> code 43, arrayElement on a JSON column
 *
 * So a sub-path has to carry an explicit coercion before it is used as a value.
 *
 * WHY `toString()` AND NOT THE `.:String` TYPED SUB-COLUMN, which is what
 * ClickHouse's own error text suggests and what upstream issue #2549 proposes:
 * a JSON path may hold a DIFFERENT concrete type in every row, and `.:String`
 * is null for every row that is not stored as `String`. Measured against
 * 26.3.17.56:
 *
 *   {"port":"8080"}  dynamicType String  .:String -> '8080'  toString -> '8080'
 *   {"port":8080}    dynamicType Int64   .:String ->  NULL   toString -> '8080'
 *
 * so `port = 8080` matches one row of two. The same trap skews aggregates:
 * `avg(latency.:Float64)` returned 26.375 against a true 19.917, silently
 * dropping the row stored as `Int64`. A wrong number on a chart is worse than
 * an error, because nobody investigates it.
 */
import { findJsonExpressions } from '@/core/utils';

/** `toString(...)`, the coercion every text-shaped use needs. */
const STRING_COERCION = 'toString';

/**
 * Numeric coercion. Goes via `toString` rather than a `.:Float64` sub-column
 * for the reason in the file header -- a path stored as `Int64` in some rows
 * and `Float64` in others must contribute every row, not just the matching
 * ones. `OrNull` keeps a non-numeric row out of the aggregate instead of
 * failing the query.
 */
const NUMBER_COERCION = 'toFloat64OrNull';

/**
 * Quote one path segment for ClickHouse. Backticks inside an identifier are
 * escaped by doubling, which is what `unquoteJsonSegment` reverses.
 *
 * Mirrors `quoteJsonPathSegment` in core/metadata.ts, which is not exported.
 * Kept here rather than imported so this module stays free of a cycle, which
 * means the two agree by inspection only -- nothing asserts it.
 */
export function quoteJsonSegment(segment: string): string {
  const bare = stripBackticks(segment);
  return `\`${bare.replace(/`/g, '``')}\``;
}

/**
 * Exact inverse of `quoteJsonSegment`.
 *
 * Being an exact inverse is the whole point. Upstream PR #2551 shipped an
 * unescape that stripped backticks without undoubling them, so quoting a
 * segment containing a backtick and then unquoting it did not reach a fixed
 * point -- and the search page's canonicalise-on-load effect then rewrote an
 * ever-growing filter on every render until React threw "Maximum update depth
 * exceeded". The round trip is asserted in the tests.
 */
export function unquoteJsonSegment(segment: string): string {
  return stripBackticks(segment).replace(/``/g, '`');
}

function stripBackticks(segment: string): string {
  return segment.startsWith('`') && segment.endsWith('`') && segment.length >= 2
    ? segment.slice(1, -1)
    : segment;
}

/** `Body` + ['user','name'] -> ``Body.`user`.`name` `` (no coercion). */
export function renderJsonPath(column: string, path: string[]): string {
  const root = /^[A-Za-z_][A-Za-z0-9_]*$/.test(column)
    ? column
    : quoteJsonSegment(column);
  if (path.length === 0) return root;
  return `${root}.${path.map(quoteJsonSegment).join('.')}`;
}

/** The text-shaped expression: ``toString(Body.`user`.`name`)``. */
export function renderJsonStringExpression(
  column: string,
  path: string[],
): string {
  return `${STRING_COERCION}(${renderJsonPath(column, path)})`;
}

/** The numeric expression, for aggregates and range comparisons. */
export function renderJsonNumberExpression(
  column: string,
  path: string[],
): string {
  return `${NUMBER_COERCION}(${renderJsonStringExpression(column, path)})`;
}

/**
 * Split a rendered or raw dot-path into its segments, respecting backticks so
 * a key containing a dot survives. Returns undefined when the expression is not
 * a bare dot-path (a function call, a bracket subscript, a string literal).
 */
export function splitJsonPath(expression: string): string[] | undefined {
  if (expression.includes('(') || expression.includes('[')) return undefined;

  const segments: string[] = [];
  let current = '';
  let inBacktick = false;

  for (let i = 0; i < expression.length; i++) {
    // charAt rather than [i] throughout: the index is a loop counter, and the
    // bracket form trips security/detect-object-injection on every read.
    const c = expression.charAt(i);
    if (c === '`') {
      // A doubled backtick is an escaped one, not a delimiter.
      if (inBacktick && expression.charAt(i + 1) === '`') {
        current += '``';
        i++;
        continue;
      }
      inBacktick = !inBacktick;
      current += c;
    } else if (c === '.' && !inBacktick) {
      segments.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (inBacktick) return undefined; // unterminated -- not ours to touch
  segments.push(current);

  return segments.some(s => s.length === 0) ? undefined : segments;
}

/**
 * The root column of a native-JSON dot path, when that root is one of
 * `jsonColumns`. Undefined for anything else -- a plain column, a Map subscript,
 * a function call.
 *
 * `parseKeyPath` in core/metadata.ts splits BRACKET form only, so a JSON dot
 * path reaches the facet dispatch as one opaque segment and matches no column
 * name. This is what lets that dispatch recognise it as a sub-path.
 */
export function dfeJsonPathRoot(
  keyExpression: string,
  jsonColumns: Iterable<string>,
): string | undefined {
  const segments = splitJsonPath(keyExpression);
  if (!segments || segments.length < 2) return undefined;

  const root = unquoteJsonSegment(segments[0]);
  return new Set(jsonColumns).has(root) ? root : undefined;
}

/**
 * Rewrite every native-JSON sub-path in a SQL fragment so it carries a
 * `toString()` coercion.
 *
 * This is the single seam. It is called at query RENDER time rather than when
 * a filter key is built, so one call covers search, charts, dashboards and
 * alerts -- they all render through `renderWhereExpressionStr`.
 *
 * Only paths whose ROOT is a known native `JSON` column are touched, so
 * `table.column` references and Map access are left exactly as they were.
 *
 * Idempotent: an expression already inside a `toString(...)` is skipped, so
 * rendering twice is the same as rendering once.
 */
export function coerceJsonPathsInSql(
  sql: string,
  jsonColumns: Iterable<string>,
): string {
  const roots = new Set(jsonColumns);
  if (roots.size === 0 || !sql) return sql;

  const found = findJsonExpressions(sql);
  if (found.length === 0) return sql;

  const literalSpans = quotedSpans(sql);

  // Apply right-to-left so earlier indices stay valid as the string grows.
  let out = sql;
  for (const { expr: rawExpr, index } of [...found].sort(
    (a, b) => b.index - a.index,
  )) {
    // A path ending in a type specifier comes back with the ENCLOSING call's
    // closing paren attached. Consuming it unbalances the aggregate around it,
    // which is a syntax error that fails the whole batch.
    const expr = rawExpr.replace(/\)+$/, '');

    const segments = splitJsonPath(expr);
    if (!segments || segments.length < 2) continue;
    if (!segments.every(isLegalSegment)) continue;

    const root = unquoteJsonSegment(segments[0]);
    if (!roots.has(root)) continue;
    if (literalSpans.some(([from, to]) => index >= from && index < to))
      continue;

    const path = stripTypeSuffix(segments.slice(1));
    if (path.length === 0) continue;

    // A typed sub-column still has to go inside an existing coercion, because
    // the wrapper does not stop `.:String` reading NULL for a differently-typed
    // row. Only the suffix is dropped there -- re-wrapping would just nest.
    const inCoercion = isAlreadyCoerced(sql, index);
    const hadTypeSuffix = path.length !== segments.length - 1;
    if (inCoercion && !hadTypeSuffix) continue;

    const unquoted = path.map(unquoteJsonSegment);
    const coerced = inCoercion
      ? renderJsonPath(root, unquoted)
      : renderJsonStringExpression(root, unquoted);
    out = out.slice(0, index) + coerced + out.slice(index + expr.length);
  }

  return out;
}

/**
 * True when a segment is a name we can safely re-quote as a JSON key.
 *
 * `findJsonExpressions` ends a token only on whitespace, a paren, a brace, a
 * bracket, a comma or an arithmetic operator, so `=`, `!`, `<`, `>`, `%` and a
 * `::` cast all arrive glued to the last segment. Re-quoting one of those
 * produces a lookup for a key no row has, and `Body.status=200` collapses a
 * whole predicate into a single string. Declining is always safe: the
 * expression is left exactly as the user wrote it.
 */
function isLegalSegment(segment: string): boolean {
  if (segment.startsWith('`')) return segment.endsWith('`');
  // A leading colon is the typed sub-column marker, stripped further down.
  return /^:?[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment);
}

/**
 * Half-open [start, end) spans of every single-quoted literal and SQL comment.
 *
 * Upstream's own literal skip in `findJsonExpressions` never advances, so a
 * dot-path written inside a search term is reported as if it were code. Upstream
 * survives that because it puts the same bytes back; we substitute different
 * ones, which silently rewrites what the analyst typed.
 */
function quotedSpans(sql: string): [number, number][] {
  const spans: [number, number][] = [];

  for (let i = 0; i < sql.length; i++) {
    // charAt rather than [i] throughout: the index is a loop counter, and the
    // bracket form trips security/detect-object-injection on every read.
    const c = sql.charAt(i);

    if (c === '-' && sql.charAt(i + 1) === '-') {
      const end = sql.indexOf('\n', i);
      spans.push([i, end === -1 ? sql.length : end]);
      i = end === -1 ? sql.length : end;
      continue;
    }

    if (c === '/' && sql.charAt(i + 1) === '*') {
      const end = sql.indexOf('*/', i + 2);
      spans.push([i, end === -1 ? sql.length : end + 2]);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }

    if (c !== "'") continue;

    const start = i;
    i++;
    while (i < sql.length) {
      if (sql.charAt(i) === '\\') {
        i += 2;
        continue;
      }
      if (sql.charAt(i) === "'") {
        // A doubled quote is an escaped one, not the end of the literal.
        if (sql.charAt(i + 1) === "'") {
          i += 2;
          continue;
        }
        break;
      }
      i++;
    }
    spans.push([start, Math.min(i + 1, sql.length)]);
  }

  return spans;
}

/**
 * Drop a trailing typed sub-column marker (`.:String`) from a path.
 *
 * It is a TYPE, not a path segment, so quoting it as one looks up a JSON key
 * literally named `:String` and reads empty for every row. Dropping it also
 * upgrades the expression to `toString()`, which is what a mixed-type path
 * needs -- see the file header.
 */
function stripTypeSuffix(path: string[]): string[] {
  const last = path[path.length - 1];
  return last?.startsWith(':') ? path.slice(0, -1) : path;
}

/**
 * True when the expression at `index` is the sole argument of a coercion we
 * (or upstream's Lucene serializer) already emitted. Cheap textual check --
 * it only has to recognise our own output, not parse SQL.
 */
function isAlreadyCoerced(sql: string, index: number): boolean {
  const before = sql.slice(0, index);
  return /(?:toString|dynamicType|getSubcolumn)\($/.test(before);
}

/** Structural shape of the metadata reader, to keep this module cycle-free. */
type ColumnReader = {
  getColumns(args: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  }): Promise<{ name: string; type: string }[]>;
};

/**
 * Coerce every native-JSON sub-path in a rendered SQL fragment.
 *
 * The seam, called from two places every query already passes through:
 * `renderWhereExpressionStr` for filters (search, charts, dashboards, alerts)
 * and `renderSelectList`'s raw-string branch for GROUP BY keys. Failure to read
 * the schema leaves the fragment untouched rather than blocking the query.
 *
 * Aggregate ARGUMENTS need no pass here: upstream's `aggFnExpr` already emits
 * `toFloat64OrDefault(toString(expr))` around them, which `isAlreadyCoerced`
 * recognises and leaves alone.
 */
/**
 * The same coercion, applied to a chart config's `orderBy` before it renders.
 *
 * `renderOrderBy` is synchronous and reaches `renderSortSpecificationList`
 * directly, so the seam cannot sit inside it. Sorting by a JSON sub-path is
 * ClickHouse code 44 -- not allowed in ORDER BY keys -- which is one of the
 * cases this whole module exists to fix.
 *
 * Returns the config unchanged when there is nothing to do, so the call site
 * stays a single expression.
 */
export async function dfeCoerceOrderBy<
  T extends {
    orderBy?: unknown;
    from?: { databaseName: string; tableName: string };
    connection?: string;
  },
>(chartConfig: T, metadata: ColumnReader): Promise<T> {
  const { orderBy, from, connection } = chartConfig;
  if (!from || !connection) return chartConfig;

  const coerce = (expression: string) =>
    dfeCoerceJsonPaths(expression, {
      metadata,
      databaseName: from.databaseName,
      tableName: from.tableName,
      connectionId: connection,
    });

  if (typeof orderBy === 'string') {
    return { ...chartConfig, orderBy: await coerce(orderBy) };
  }

  if (Array.isArray(orderBy)) {
    return {
      ...chartConfig,
      orderBy: await Promise.all(
        orderBy.map(async spec =>
          spec && typeof spec.valueExpression === 'string'
            ? { ...spec, valueExpression: await coerce(spec.valueExpression) }
            : spec,
        ),
      ),
    };
  }

  return chartConfig;
}

export async function dfeCoerceJsonPaths(
  condition: string,
  {
    metadata,
    databaseName,
    tableName,
    connectionId,
  }: {
    metadata: ColumnReader;
    databaseName: string;
    tableName: string;
    connectionId: string;
  },
): Promise<string> {
  if (!condition || !databaseName || !tableName) return condition;

  try {
    const columns = await metadata.getColumns({
      databaseName,
      tableName,
      connectionId,
    });
    const jsonColumns = columns
      .filter(c => c.type.startsWith('JSON'))
      .map(c => c.name);
    return coerceJsonPathsInSql(condition, jsonColumns);
  } catch {
    return condition;
  }
}
