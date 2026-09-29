/**
 * DFE throughput: events written to ClickHouse per second, read from the
 * stack's own self-monitoring metrics.
 *
 * The loader counts every row it inserts in `rows_inserted_total`, whichever
 * path the record took to reach it (Kafka or direct gRPC), so the sum across
 * every loader instance and pod is the whole stack's figure. It is a
 * cumulative counter, so it is read with `increase`, which differences each
 * series and clamps a restart's reset; summing the raw values would add up
 * running totals.
 */

import { convertGranularityToSeconds } from '@hyperdx/common-utils/dist/core/utils';
import {
  ChartConfigWithDateRange,
  DisplayType,
  isMetricSource,
  MetricsDataType,
  TMetricSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';

/** The loader's cumulative count of rows inserted into ClickHouse. */
export const THROUGHPUT_METRIC = 'rows_inserted_total';

/** Seeded for the platform team only (api/src/dfe/controllers/org-connection.ts). */
export const THROUGHPUT_SOURCE_NAME = 'otel_metrics';

export const THROUGHPUT_WINDOW_MS = 15 * 60 * 1000;

const BUCKET_GRANULARITY = '1 minute';
const BUCKET_SECONDS = convertGranularityToSeconds(BUCKET_GRANULARITY);

export type ThroughputPoint = { x: number; y: number };

export type ThroughputSummary = {
  perSecond: number;
  points: ThroughputPoint[];
};

/**
 * The team's self-monitoring metric source, matched by name.
 *
 * A tenant team holds no such source, since operator telemetry never reaches
 * an org viewer, so the caller renders nothing for it.
 */
export function findThroughputSource(
  sources: readonly TSource[] | undefined,
): TMetricSource | undefined {
  return (sources ?? [])
    .filter(isMetricSource)
    .find(s => s.name.toLowerCase() === THROUGHPUT_SOURCE_NAME);
}

/** Rows written per minute bucket over `dateRange`, all loaders summed. */
export function throughputChartConfig(
  source: TMetricSource,
  dateRange: [Date, Date],
): ChartConfigWithDateRange {
  return {
    source: source.id,
    connection: source.connection,
    displayType: DisplayType.Line,
    dateRange,
    granularity: BUCKET_GRANULARITY,
    timestampValueExpression: source.timestampValueExpression,
    from: {
      databaseName: source.from.databaseName,
      tableName: source.metricTables[MetricsDataType.Sum] ?? '',
    },
    metricTables: source.metricTables,
    select: [
      {
        aggFn: 'increase',
        aggCondition: '',
        aggConditionLanguage: 'sql',
        valueExpression: 'Value',
        metricType: MetricsDataType.Sum,
        metricName: THROUGHPUT_METRIC,
      },
    ],
    where: '',
    whereLanguage: 'sql',
  };
}

/**
 * Events a second across the window's complete minutes, or undefined when no
 * loader reported in any of them.
 *
 * The minute still in progress is left out because its later readings have
 * not been exported yet, so it always reads low. The rate spans first to last
 * complete minute, so a minute with no reading, which happens when an export
 * lands either side of a bucket edge, does not inflate it.
 */
export function summariseThroughput(
  points: readonly ThroughputPoint[],
  nowSeconds: number,
): ThroughputSummary | undefined {
  const complete = points
    .filter(p => p.x + BUCKET_SECONDS <= nowSeconds)
    .sort((a, b) => a.x - b.x);
  const first = complete[0];
  const last = complete[complete.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }

  const total = complete.reduce((sum, p) => sum + p.y, 0);
  const spanSeconds = last.x + BUCKET_SECONDS - first.x;
  return { perSecond: total / spanSeconds, points: complete };
}
