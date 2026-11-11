/**
 * The seed fields of GET /api/v1/hyperdx/connection, as the engine answers them.
 */

const SEED_TABLE_IDS = [
  'main',
  'detection',
  'otel_logs',
  'otel_traces',
  'otel_metrics_gauge',
  'otel_metrics_sum',
  'otel_metrics_histogram',
  'otel_metrics_exponential_histogram',
  'otel_metrics_summary',
];

/** `platform`, `database` and every seed table, named `<prefix><id name>`. */
export function seedFields(platform: boolean, database = 'dfe', prefix = '') {
  return {
    platform,
    database,
    tables: Object.fromEntries(
      SEED_TABLE_IDS.map(id => [`data.${id}`, `${prefix}${id}`]),
    ),
  };
}
