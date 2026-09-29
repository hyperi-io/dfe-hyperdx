/**
 * The preset dashboards upstream offers. This fork ships none of their pages
 * (/services, /clickhouse, /kubernetes), so every one of them would 404.
 */
export function dfePresetDashboards<T>(_upstream: readonly T[]): T[] {
  return [];
}
