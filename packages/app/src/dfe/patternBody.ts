/**
 * The text the pattern miner reads from a row's body column.
 *
 * A native ClickHouse `JSON` body (every DFE source's `_json`) arrives as an
 * object, and drain3 calls `.strip()` on its input.
 */
export function dfePatternBody(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
