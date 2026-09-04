/**
 * `Nullable(JSON)` must read as a JSON column.
 *
 * Upstream unwraps `Nullable(...)` recursively and so already gets this right;
 * the case is held here because the fork's native-JSON path (jsonPath.ts,
 * dfeJsonColumnsFromFields, the JSON viewer) is built on the classification,
 * and DFE's own `_json` column is nullable in some sources.
 *
 * Migrated out of `src/__tests__/clickhouse.test.ts`, which is upstream's.
 */
import { convertCHDataTypeToJSType, JSDataType } from '@/clickhouse';

describe('convertCHDataTypeToJSType', () => {
  it('classifies Nullable(JSON) as JSON', () => {
    expect(convertCHDataTypeToJSType('Nullable(JSON)')).toBe(JSDataType.JSON);
  });
});
