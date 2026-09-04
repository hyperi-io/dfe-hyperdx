/**
 * A `Nullable(JSON)` column must be named as a JSON column.
 *
 * `getJSONColumnNames` decides which columns the fork renders through the JSON
 * viewer and coerces with `toString()`; a nullable one missing from that list
 * falls back to the flat renderer and to `col['key']`, which ClickHouse rejects
 * on a JSON column. DFE's own `_json` is nullable in some sources.
 *
 * Migrated out of `src/components/__tests__/DBRowDataPanel.test.ts`, which is
 * upstream's.
 */
import { getJSONColumnNames } from '@/components/DBRowDataPanel';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

describe('getJSONColumnNames', () => {
  it('counts Nullable(JSON) alongside JSON and JSON(1)', () => {
    const meta = [
      { name: 'col1', type: 'String' },
      { name: 'col2', type: 'JSON' },
      { name: 'col3', type: 'JSON(1)' },
      { name: 'col4', type: 'Nullable(JSON)' },
    ];

    expect(getJSONColumnNames(meta)).toEqual(['col2', 'col3', 'col4']);
  });
});
