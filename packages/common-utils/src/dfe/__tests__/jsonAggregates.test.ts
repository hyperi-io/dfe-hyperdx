/**
 * Chart aggregates on a native-JSON path, rendered end to end, so the call in
 * `renderSelectList` is pinned as well as `dfeJsonAggregates` itself.
 */
import { parameterizedQueryToSql } from '@/clickhouse';
import { Metadata } from '@/core/metadata';
import { renderChartConfig } from '@/core/renderChartConfig';
import {
  BuilderChartConfig,
  ChartConfigWithOptDateRange,
  DisplayType,
} from '@/types';

const metadata = {
  getColumns: jest.fn().mockResolvedValue([
    { name: 'timestamp', type: 'DateTime' },
    { name: '_json', type: 'JSON(max_dynamic_paths=2048)' },
    { name: 'Duration', type: 'Float64' },
  ]),
  getColumn: jest.fn().mockResolvedValue(undefined),
  getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(new Map()),
  getTableMetadata: jest.fn().mockResolvedValue({ primary_key: 'timestamp' }),
  getSkipIndices: jest.fn().mockResolvedValue([]),
  getSetting: jest.fn().mockResolvedValue(undefined),
  isClickHouseCloud: jest.fn().mockResolvedValue(false),
} as unknown as Metadata;

const config = (
  select: BuilderChartConfig['select'],
): ChartConfigWithOptDateRange => ({
  displayType: DisplayType.Table,
  connection: 'conn',
  from: { databaseName: 'dfe', tableName: 'main' },
  select,
  where: '',
  whereLanguage: 'sql',
  timestampValueExpression: 'timestamp',
  dateRange: [new Date('2026-11-01'), new Date('2026-11-02')],
});

const render = async (select: BuilderChartConfig['select']) =>
  parameterizedQueryToSql(
    await renderChartConfig(config(select), metadata, []),
  );

// The materialized-column pass re-prints the select (`AVG`, a quoted root), so
// the shapes are matched loosely.
describe('chart aggregates on a native-JSON path', () => {
  it('skip non-numeric rows instead of counting them as 0', async () => {
    const sql = await render([
      { aggFn: 'avg', valueExpression: '_json.latency', aggCondition: '' },
    ]);
    expect(sql).toMatch(
      /AVG\(toFloat64OrNull\(toString\(`?_json`?\.latency\)\)\)/i,
    );
    expect(sql).not.toContain('toFloat64OrDefault');
  });

  it('drop non-numeric rows from a filtered aggregate too', async () => {
    const sql = await render([
      {
        aggFn: 'max',
        valueExpression: '_json.latency',
        aggCondition: "_json.level = 'error'",
        aggConditionLanguage: 'sql',
      },
    ]);
    expect(sql).toContain('maxIf(');
    expect(sql).toMatch(
      /toFloat64OrNull\(toString\(`?_json`?\.latency\)\) IS NOT NULL/,
    );
    expect(sql).not.toContain('toFloat64OrDefault');
  });

  it('leave a plain column on the upstream cast', async () => {
    const sql = await render([
      { aggFn: 'avg', valueExpression: 'Duration', aggCondition: '' },
    ]);
    expect(sql).toMatch(/AVG\(toFloat64OrDefault\(toString\(Duration\)\)\)/i);
  });
});
