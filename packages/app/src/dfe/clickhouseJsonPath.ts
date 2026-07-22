/**
 * DFE: SQL path expressions for NATIVE ClickHouse JSON columns.
 *
 * WHY THIS FILE EXISTS - and why it is not an edit to DBRowJsonViewer:
 *
 * Upstream builds path expressions for String columns holding JSON and for Map
 * sub-values. Both are already `String`, so `JSONExtract*` accepts them. A
 * column of the native ClickHouse `JSON` type is neither:
 *
 *   - `col['k']` on a JSON column is `arrayElement`, which ClickHouse rejects
 *     ("Illegal types of arguments ... for function arrayElement").
 *   - a JSON sub-path yields `Dynamic`, which `JSONExtract*` also rejects
 *     (code 43, "Illegal type ... of argument").
 *
 * So a native JSON root must be coerced with `toString()` BEFORE the extract,
 * not after the sub-path has already been taken.
 *
 * `DBRowJsonViewer` is upstream's most-churned file in this area - 11 commits,
 * with #2561 queued in `upstream/main` right now - and `git rerere` replays a
 * conflict resolution only when the preimage matches EXACTLY. Editing a
 * function BODY there buys a fresh hand-resolve every single sync. So the whole
 * of our logic lives here, and the call sites carry the smallest edit that can
 * express it: one swapped identifier, or a three-line `else if` appended to an
 * existing brace. See FORK.md.
 *
 * DIRECTION OF TRAVEL: upstream #2344 ("don't wrap JSON filters in toString
 * until query rendering") moved deliberately away from build-time wrapping, and
 * #2561 generalised the render-time pass-through guard in
 * `DBSearchPageFilters/utils.ts`. If this coercion can move to that seam after
 * the next sync it should, because it would delete our call-site surface
 * outright. Better still, upstream it - this is a real defect against the JSON
 * type they already support (#969), not a DFE preference.
 */
import { mergePath } from '@/utils';

export type JSONExtractFn =
  | 'JSONExtractString'
  | 'JSONExtractFloat'
  | 'JSONExtractBool';

const quoteArgs = (path: string[]): string =>
  path.map(p => `'${p}'`).join(', ');

/**
 * Path expression for a value inside a native JSON column, outside the
 * parsed-JSON view.
 *
 * Callers gate on upstream's own `isJsonColumn`, so `keyPath[0]` is known to be
 * a native JSON column here. For a bare root this returns exactly what upstream
 * emits (`toString(col)`); only the nested case diverges, because that is the
 * only case upstream gets wrong.
 */
export function dfeJsonColumnPath(keyPath: string[]): string {
  const root = keyPath[0];
  const nested = keyPath.slice(1);
  if (nested.length === 0) {
    return `toString(${root})`;
  }
  return `JSONExtractString(toString(${root}), ${quoteArgs(nested)})`;
}

/**
 * Drop-in for upstream's `buildJSONExtractQuery` with an IDENTICAL signature,
 * so the call sites differ from upstream by one identifier and nothing else.
 *
 * Behaviour is upstream's, except that a native JSON root is coerced with
 * `toString()` before the extract.
 *
 * The base-column computation is duplicated from upstream rather than delegated
 * to it, to avoid an import cycle (`DBRowJsonViewer` imports this module). That
 * duplication is the one real risk here - upstream could change `mergePath`
 * semantics or the emitted shape and we would not notice. So
 * `__tests__/clickhouseJsonPath.test.ts` asserts this function agrees with
 * upstream's, case for case, for every NON-native input. If upstream drifts,
 * that test fails in our own CI rather than the bug reaching a WHERE clause.
 */
export function dfeJsonExtractQuery(
  keyPath: string[],
  parsedJsonRootPath: string[],
  jsonColumns: string[] = [],
  jsonExtractFn: JSONExtractFn = 'JSONExtractString',
  mapColumns: string[] = [],
): string | null {
  const nestedPath = keyPath.slice(parsedJsonRootPath.length);
  if (nestedPath.length === 0) {
    return null; // No nested path to extract -- same as upstream.
  }

  const baseColumn = mergePath(parsedJsonRootPath, jsonColumns, mapColumns);
  const isNativeJsonRoot = jsonColumns.includes(parsedJsonRootPath[0]);
  const expr = isNativeJsonRoot ? `toString(${baseColumn})` : baseColumn;

  return `${jsonExtractFn}(${expr}, ${quoteArgs(nestedPath)})`;
}
