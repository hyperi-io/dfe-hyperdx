import {
  JSDataType,
  type ColumnMetaType,
  convertCHDataTypeToJSType,
} from '@hyperdx/common-utils/dist/clickhouse';
import type { Field } from '@hyperdx/common-utils/dist/core/metadata';

/**
 * Native `JSON` column names from an already-fetched field list.
 *
 * Mirrors `deriveMapColumnsFromFields`, and exists for the same reason: a
 * nested path needs to know whether its ROOT is a Map or a JSON column, because
 * `col['key']` on a JSON column is `arrayElement` and ClickHouse rejects it.
 *
 * Reads the field list the caller already has rather than issuing a schema
 * query, so it adds no round trip. Top-level only -- a JSON sub-path reports
 * its own leaf type, not `JSON`.
 */
export function dfeJsonColumnsFromFields(
  fields: readonly Field[] | undefined,
): string[] {
  return (fields ?? [])
    .filter(f => f.path.length === 1 && f.jsType === JSDataType.JSON)
    .map(f => f.path[0]);
}

/** Same, from raw column metadata. */
export function dfeJsonColumnsFromMeta(
  columns: readonly ColumnMetaType[] | undefined,
): string[] {
  return (columns ?? [])
    .filter(c => convertCHDataTypeToJSType(c.type) === JSDataType.JSON)
    .map(c => c.name);
}
