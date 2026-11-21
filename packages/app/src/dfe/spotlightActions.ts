/**
 * Command palette entries for pages this fork blocks or does not ship, and the
 * two that link out to ClickStack.
 */
const DROPPED_IDS: ReadonlySet<string> = new Set([
  'sessions',
  'alerts',
  'service-health',
  'team-settings',
  'documentation',
  'cloud',
]);

export function dfeSpotlightActions<T extends { id?: string }>(
  upstream: readonly T[],
): T[] {
  return upstream.filter(({ id }) => id == null || !DROPPED_IDS.has(id));
}
