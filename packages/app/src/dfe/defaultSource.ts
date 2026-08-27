/**
 * DFE: which source the search page opens on when nothing else decides.
 *
 * DFE analysts work from hunt detections, so `hunts` is the landing view rather
 * than whichever source happens to sort first. Upstream's own precedence is
 * unchanged and still wins ahead of this: an explicit source in the URL, a saved
 * search, and the user's last selection all take priority, so this only decides
 * a cold start.
 *
 * The name is the contract, not an id -- ids are per-deployment, and the seeded
 * source set names this table `hunts` (see
 * api/src/dfe/controllers/org-connection.ts). A deployment that lands somewhere
 * else sets NEXT_PUBLIC_DFE_DEFAULT_SOURCE.
 */

/** Empty disables the preference entirely, leaving upstream's ordering. */
const DFE_DEFAULT_SOURCE_NAME =
  process.env.NEXT_PUBLIC_DFE_DEFAULT_SOURCE ?? 'hunts';

type NamedSource = { id: string; name?: string };

/**
 * The id of the preferred source, or undefined when this deployment has no such
 * source -- in which case the caller keeps whatever it would have chosen.
 *
 * `sources` must already be filtered to what the calling page can display, so a
 * preference never selects a source that page would refuse to render.
 */
export function dfePreferredSourceId(
  sources: readonly NamedSource[],
): string | undefined {
  if (!DFE_DEFAULT_SOURCE_NAME) return undefined;

  const wanted = DFE_DEFAULT_SOURCE_NAME.toLowerCase();
  return sources.find(s => s.name?.toLowerCase() === wanted)?.id;
}
