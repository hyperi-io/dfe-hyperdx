import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  MetricsDataType,
  SourceKind,
  TLogSource,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

import {
  findThroughputSource,
  summariseThroughput,
  THROUGHPUT_METRIC,
  throughputChartConfig,
} from '@/dfe/throughput';

const metricSource: TMetricSource = {
  id: 'm1',
  name: 'otel_metrics',
  kind: SourceKind.Metric,
  connection: 'c1',
  from: { databaseName: 'dfe', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: {
    [MetricsDataType.Gauge]: 'otel_metrics_gauge',
    [MetricsDataType.Sum]: 'otel_metrics_sum',
    [MetricsDataType.Histogram]: 'otel_metrics_histogram',
    [MetricsDataType.ExponentialHistogram]:
      'otel_metrics_exponential_histogram',
    [MetricsDataType.Summary]: 'otel_metrics_summary',
  },
};

const logSource: TLogSource = {
  id: 'l1',
  name: 'otel_metrics',
  kind: SourceKind.Log,
  connection: 'c1',
  from: { databaseName: 'dfe', tableName: 'otel_logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, Body',
};

describe('findThroughputSource', () => {
  it('finds the seeded metric source by name, ignoring case', () => {
    const renamed = { ...metricSource, name: 'OTEL_Metrics' };
    expect(findThroughputSource([renamed])?.id).toBe('m1');
  });

  it('ignores a non-metric source that happens to share the name', () => {
    expect(findThroughputSource([logSource])).toBeUndefined();
  });

  it('finds nothing for a tenant team, which holds no otel source', () => {
    const main = { ...logSource, id: 'main', name: 'main' };
    expect(findThroughputSource([main])).toBeUndefined();
  });

  it('finds nothing before the sources have loaded', () => {
    expect(findThroughputSource(undefined)).toBeUndefined();
    expect(findThroughputSource([])).toBeUndefined();
  });
});

describe('throughputChartConfig', () => {
  const dateRange: [Date, Date] = [
    new Date('2026-09-29T00:00:00Z'),
    new Date('2026-09-29T00:15:00Z'),
  ];
  it('reads the loader counter as an increase, never a raw sum', () => {
    const config = throughputChartConfig(metricSource, dateRange);
    if (!isBuilderChartConfig(config) || typeof config.select === 'string') {
      throw new Error('expected a builder config with a select list');
    }
    expect(config.select).toEqual([
      expect.objectContaining({
        aggFn: 'increase',
        metricType: MetricsDataType.Sum,
        metricName: THROUGHPUT_METRIC,
      }),
    ]);
  });

  it('takes the database and tables from the source, not a literal', () => {
    const config = throughputChartConfig(metricSource, dateRange);
    if (!isBuilderChartConfig(config)) throw new Error('expected builder');
    expect(config.from).toEqual({
      databaseName: 'dfe',
      tableName: 'otel_metrics_sum',
    });
    expect(config.metricTables).toBe(metricSource.metricTables);
    expect(config.connection).toBe('c1');
    expect(config.granularity).toBe('1 minute');
    expect(config.dateRange).toBe(dateRange);
  });
});

describe('summariseThroughput', () => {
  // 00:15:30 -- the 00:15 minute is still in progress.
  const now = Date.parse('2026-09-29T00:15:30Z') / 1000;
  const minute = (m: number) =>
    Date.parse(`2026-09-29T00:${String(m).padStart(2, '0')}:00Z`) / 1000;

  it('reports no data when no loader has reported', () => {
    expect(summariseThroughput([], now)).toBeUndefined();
  });

  it('reports no data while only the current minute has a reading', () => {
    expect(summariseThroughput([{ x: minute(15), y: 600 }], now)).toBe(
      undefined,
    );
  });

  it('averages complete minutes and leaves out the one in progress', () => {
    const summary = summariseThroughput(
      [
        { x: minute(13), y: 600 },
        { x: minute(14), y: 1200 },
        { x: minute(15), y: 5 },
      ],
      now,
    );
    expect(summary?.perSecond).toBe(15);
    expect(summary?.points.map(p => p.x)).toEqual([minute(13), minute(14)]);
  });

  it('does not inflate the rate across a minute with no reading', () => {
    // An export landing either side of a bucket edge leaves one minute empty
    // and puts two readings in its neighbour.
    const summary = summariseThroughput(
      [
        { x: minute(10), y: 600 },
        { x: minute(12), y: 1200 },
      ],
      now,
    );
    expect(summary?.perSecond).toBe(10);
  });

  it('reads zero, not no data, when loaders report but nothing flows', () => {
    const summary = summariseThroughput(
      [
        { x: minute(13), y: 0 },
        { x: minute(14), y: 0 },
      ],
      now,
    );
    expect(summary?.perSecond).toBe(0);
  });

  it('orders the points by time whatever order they arrive in', () => {
    const summary = summariseThroughput(
      [
        { x: minute(14), y: 120 },
        { x: minute(12), y: 60 },
      ],
      now,
    );
    expect(summary?.points.map(p => p.x)).toEqual([minute(12), minute(14)]);
  });
});
