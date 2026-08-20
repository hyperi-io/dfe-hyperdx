// DFE pre-canned dashboard definitions.
//
// Built as functions rather than shipped as JSON files because a tile's `source`
// and `connection` are Mongo ObjectIds minted per team at seed time. The upstream
// file provisioner writes tiles verbatim with no name resolution, so a JSON file
// naming a source by name stores a name where an id belongs and fails at render.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import {
  DashboardWithoutId,
  DashboardWithoutIdSchema,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

// The dashboard grid is 24 columns (DBDashboardPage react-grid-layout).
const GRID_COLUMNS = 24;
const HEADLINE_TILE_WIDTH = GRID_COLUMNS / 6;
const HALF_WIDTH = GRID_COLUMNS / 2;
const HEADLINE_HEIGHT = 3;
const CHART_HEIGHT = 6;

// End-to-end ingest lag: receiver in, ClickHouse row visible. Both columns are
// written by the pipeline itself, so this is a measurement rather than an estimate.
const INGEST_LAG_MS =
  "dateDiff('millisecond', _timestamp_received, _timestamp_load)";

// How far behind the event's own clock the receiver was. Catches a source with a
// wrong clock or a long local buffer, which no other tile shows.
const EVENT_SKEW_SECONDS =
  "dateDiff('second', _timestamp, _timestamp_received)";

interface TileSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  source: string;
  displayType: DisplayType;
  select: Record<string, unknown>[];
  groupBy?: string;
  granularity?: 'auto';
  orderBy?: string;
  limit?: { limit: number };
  numberFormat?: Record<string, unknown>;
}

function tile(spec: TileSpec) {
  const { id, x, y, w, h, name, source, displayType, select, ...rest } = spec;
  return {
    id,
    x,
    y,
    w,
    h,
    config: {
      name,
      source,
      displayType,
      select,
      where: '',
      whereLanguage: 'lucene' as const,
      ...rest,
    },
  };
}

// A plain aggregate over the events table. aggCondition/aggConditionLanguage are
// required by the schema even when empty.
function agg(
  aggFn: string,
  valueExpression: string,
  alias?: string,
): Record<string, unknown> {
  return {
    aggFn,
    valueExpression,
    aggCondition: '',
    aggConditionLanguage: 'lucene',
    ...(alias ? { alias } : {}),
  };
}

// Parsing rather than asserting: the tile builders assemble loosely-typed select
// entries, and a definition that drifts out of schema should fail here rather than
// write a dashboard whose tiles are dropped silently at render.
function validated(dashboard: unknown): DashboardWithoutId {
  return DashboardWithoutIdSchema.parse(dashboard);
}

function quantile(
  level: number,
  valueExpression: string,
  alias: string,
): Record<string, unknown> {
  return {
    aggFn: 'quantile',
    level,
    valueExpression,
    aggCondition: '',
    aggConditionLanguage: 'lucene',
    alias,
  };
}

/**
 * DFE Throughput - the landing dashboard, seeded to EVERY team.
 *
 * One definition serves both audiences because the ClickHouse row policy already
 * makes the answer role-dependent: the platform reader sees every org broken out
 * by _org_id, and an org_viewer sees the identical tiles fenced to their own org,
 * where the group-by collapses to a single series.
 */
export function buildThroughputDashboard(
  defaultSourceId: string,
): DashboardWithoutId {
  const s = defaultSourceId;
  const tiles = [
    tile({
      id: 'events-total',
      x: 0,
      y: 0,
      w: HEADLINE_TILE_WIDTH,
      h: HEADLINE_HEIGHT,
      name: 'Events ingested',
      source: s,
      displayType: DisplayType.Number,
      select: [agg('count', '')],
    }),
    tile({
      id: 'bytes-total',
      x: HEADLINE_TILE_WIDTH,
      y: 0,
      w: HEADLINE_TILE_WIDTH,
      h: HEADLINE_HEIGHT,
      name: 'Bytes ingested',
      source: s,
      displayType: DisplayType.Number,
      select: [agg('sum', 'length(_raw)')],
      numberFormat: { output: 'byte' },
    }),
    tile({
      id: 'active-orgs',
      x: HEADLINE_TILE_WIDTH * 2,
      y: 0,
      w: HEADLINE_TILE_WIDTH,
      h: HEADLINE_HEIGHT,
      name: 'Active orgs',
      source: s,
      displayType: DisplayType.Number,
      select: [agg('count_distinct', '_org_id')],
    }),
    tile({
      id: 'active-sources',
      x: HEADLINE_TILE_WIDTH * 3,
      y: 0,
      w: HEADLINE_TILE_WIDTH,
      h: HEADLINE_HEIGHT,
      name: 'Active sources',
      source: s,
      displayType: DisplayType.Number,
      select: [agg('count_distinct', '_source')],
    }),
    tile({
      id: 'lag-p95',
      x: HEADLINE_TILE_WIDTH * 4,
      y: 0,
      w: HEADLINE_TILE_WIDTH,
      h: HEADLINE_HEIGHT,
      name: 'Ingest lag p95 (ms)',
      source: s,
      displayType: DisplayType.Number,
      select: [quantile(0.95, INGEST_LAG_MS, 'p95')],
    }),
    tile({
      id: 'lag-max',
      x: HEADLINE_TILE_WIDTH * 5,
      y: 0,
      w: HEADLINE_TILE_WIDTH,
      h: HEADLINE_HEIGHT,
      name: 'Ingest lag max (ms)',
      source: s,
      displayType: DisplayType.Number,
      select: [agg('max', INGEST_LAG_MS)],
    }),

    // The org breakdown. On a tenant team the row policy leaves one series.
    tile({
      id: 'events-by-org',
      x: 0,
      y: HEADLINE_HEIGHT,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Events per interval by org',
      source: s,
      displayType: DisplayType.StackedBar,
      select: [agg('count', '')],
      groupBy: '_org_id',
      granularity: 'auto',
    }),
    tile({
      id: 'events-by-source',
      x: HALF_WIDTH,
      y: HEADLINE_HEIGHT,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Events per interval by source',
      source: s,
      displayType: DisplayType.StackedBar,
      select: [agg('count', '')],
      groupBy: '_source',
      granularity: 'auto',
    }),

    // Distribution, not just the headline percentile: a p95 line hides the tail
    // that actually causes complaints.
    tile({
      id: 'lag-percentiles',
      x: 0,
      y: HEADLINE_HEIGHT + CHART_HEIGHT,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Ingest lag percentiles (ms)',
      source: s,
      displayType: DisplayType.Line,
      select: [
        quantile(0.5, INGEST_LAG_MS, 'p50'),
        quantile(0.9, INGEST_LAG_MS, 'p90'),
        quantile(0.99, INGEST_LAG_MS, 'p99'),
      ],
      granularity: 'auto',
    }),
    tile({
      id: 'event-skew',
      x: HALF_WIDTH,
      y: HEADLINE_HEIGHT + CHART_HEIGHT,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Event-time skew distribution (s)',
      source: s,
      displayType: DisplayType.Heatmap,
      select: [
        {
          valueExpression: EVENT_SKEW_SECONDS,
          aggCondition: '',
          aggConditionLanguage: 'lucene',
        },
      ],
      granularity: 'auto',
    }),

    tile({
      id: 'top-orgs',
      x: 0,
      y: HEADLINE_HEIGHT + CHART_HEIGHT * 2,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Top orgs by volume',
      source: s,
      displayType: DisplayType.Table,
      select: [agg('count', '', 'events'), agg('sum', 'length(_raw)', 'bytes')],
      groupBy: '_org_id',
      orderBy: 'events DESC',
      limit: { limit: 20 },
    }),
    // Silent-source detection: a source whose newest event is old has stopped
    // shipping, which no throughput tile makes obvious on its own.
    tile({
      id: 'source-freshness',
      x: HALF_WIDTH,
      y: HEADLINE_HEIGHT + CHART_HEIGHT * 2,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Source freshness (newest event)',
      source: s,
      displayType: DisplayType.Table,
      select: [
        agg('max', '_timestamp', 'newest_event'),
        agg('count', '', 'events'),
      ],
      groupBy: '_source',
      orderBy: 'newest_event ASC',
      limit: { limit: 50 },
    }),
  ];

  return validated({
    name: 'DFE Throughput',
    tiles,
    tags: ['dfe', 'provisioned'],
  });
}

/**
 * DFE Platform Overview - seeded ONLY to the platform/admin team.
 *
 * Everything here reads an otel_* source, which tenant teams do not hold. Keeping
 * it separate is what stops a tenant carrying a dashboard whose tiles reference a
 * source id that does not exist on their team.
 */
export function buildPlatformDashboard(
  otelMetricsSourceId: string,
  otelLogsSourceId: string,
): DashboardWithoutId {
  const m = otelMetricsSourceId;

  // The scalo chassis emits these from every DFE app. Sum metrics are cumulative
  // counters, so the tiles read their per-bucket increase rather than the total.
  const metricSeries = (
    metricName: string,
    aggFn: string,
    alias: string,
  ): Record<string, unknown> => ({
    aggFn,
    metricName,
    metricType: 'sum',
    valueExpression: 'Value',
    aggCondition: '',
    aggConditionLanguage: 'lucene',
    alias,
  });

  const gaugeSeries = (
    metricName: string,
    aggFn: string,
    alias: string,
  ): Record<string, unknown> => ({
    aggFn,
    metricName,
    metricType: 'gauge',
    valueExpression: 'Value',
    aggCondition: '',
    aggConditionLanguage: 'lucene',
    alias,
  });

  const tiles = [
    // Records in versus records out. Divergence is the earliest backlog signal,
    // earlier than lag and earlier than buffer depth.
    tile({
      id: 'records-in-out',
      x: 0,
      y: 0,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Records received vs delivered',
      source: m,
      displayType: DisplayType.Line,
      select: [
        metricSeries('records_received_total', 'increase', 'received'),
        metricSeries('records_delivered_total', 'increase', 'delivered'),
      ],
      granularity: 'auto',
    }),
    tile({
      id: 'ch-rows-per-sec',
      x: HALF_WIDTH,
      y: 0,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'ClickHouse rows/sec and loader buffer',
      source: m,
      displayType: DisplayType.Line,
      select: [
        gaugeSeries('clickhouse_rows_per_second', 'avg', 'rows_per_sec'),
        gaugeSeries('buffer_rows', 'avg', 'buffer_rows'),
      ],
      granularity: 'auto',
    }),

    // Consumer-reported lag. Renders empty on slim, which has no Kafka.
    tile({
      id: 'kafka-lag',
      x: 0,
      y: CHART_HEIGHT,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Kafka consumer lag (max by partition)',
      source: m,
      displayType: DisplayType.Line,
      select: [
        gaugeSeries('rdkafka_topic_partition_consumer_lag', 'max', 'lag'),
      ],
      granularity: 'auto',
    }),
    tile({
      id: 'worker-saturation',
      x: HALF_WIDTH,
      y: CHART_HEIGHT,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'Worker pool saturation',
      source: m,
      displayType: DisplayType.Line,
      select: [gaugeSeries('worker_pool_saturation', 'max', 'saturation')],
      groupBy: 'ServiceName',
      granularity: 'auto',
    }),

    // Part pressure. A climbing max-parts-per-partition is the leading indicator
    // of the "too many parts" failure that stops writes outright.
    tile({
      id: 'ch-parts',
      x: 0,
      y: CHART_HEIGHT * 2,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'ClickHouse parts',
      source: m,
      displayType: DisplayType.Line,
      select: [
        gaugeSeries(
          'clickhouse_max_parts_per_partition',
          'max',
          'max_per_partition',
        ),
        gaugeSeries('clickhouse_active_parts', 'max', 'active_parts'),
      ],
      granularity: 'auto',
    }),
    tile({
      id: 'ch-merges',
      x: HALF_WIDTH,
      y: CHART_HEIGHT * 2,
      w: HALF_WIDTH,
      h: CHART_HEIGHT,
      name: 'ClickHouse merges and delayed inserts',
      source: m,
      displayType: DisplayType.Line,
      select: [
        gaugeSeries('clickhouse_merges_running', 'avg', 'merges_running'),
        gaugeSeries('clickhouse_delayed_inserts', 'max', 'delayed_inserts'),
      ],
      granularity: 'auto',
    }),

    // Errors, from the logs source rather than a counter, so the tile links
    // straight through to the messages.
    tile({
      id: 'error-logs',
      x: 0,
      y: CHART_HEIGHT * 3,
      w: GRID_COLUMNS,
      h: CHART_HEIGHT,
      name: 'Errors by service',
      source: otelLogsSourceId,
      displayType: DisplayType.StackedBar,
      select: [agg('count', '')],
      groupBy: 'ServiceName',
      granularity: 'auto',
    }),
  ];

  return validated({
    name: 'DFE Platform Overview',
    tiles,
    tags: ['dfe', 'provisioned', 'platform'],
  });
}
