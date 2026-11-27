/**
 * `parameterizedQueryToSql` with identifier parameters quoted.
 *
 * Upstream inlines every `{name:Identifier}` as the bare value, which is only
 * valid SQL for a plain name. A source table such as `ingest-edge` rendered as
 * `FROM dfe.ingest-edge`, so a rule exported from that source reached the
 * engine as SQL ClickHouse cannot parse. The quoting is `quoteIdentifierIfNeeded`,
 * the rule the renderer already applies to column names.
 *
 * Same signature as upstream's, so the call site swaps one identifier.
 */
import { parameterizedQueryToSql } from '@/clickhouse';
import { quoteIdentifierIfNeeded } from '@/core/metadata';

const IDENTIFIER_PLACEHOLDER = /\{(\w+):Identifier\}/g;

export function dfeParameterizedQueryToSql({
  sql,
  params,
}: {
  sql: string;
  params: Record<string, unknown>;
}): string {
  const quoted = sql.replace(IDENTIFIER_PLACEHOLDER, (placeholder, key) =>
    key in params ? quoteIdentifierIfNeeded(String(params[key])) : placeholder,
  );
  return parameterizedQueryToSql({ sql: quoted, params });
}
