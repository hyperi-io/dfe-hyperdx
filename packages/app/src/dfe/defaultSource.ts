/**
 * DFE: which source the search page opens on when nothing else decides.
 *
 * The embed opens on `all_sources`, the Merge table over the landing table and
 * every source's own table, because a first Observe load that shows nothing
 * reads as a broken deployment and `main` alone is empty once every record is
 * routed to a source of its own. Where there is no `all_sources` it opens on
 * `main`. A standalone page opens on `hunts`, since an analyst working the
 * console directly is working detections. None of these is reached until
 * upstream's own precedence has been exhausted: an explicit source in the URL,
 * a saved search, and the user's last selection all take priority, so this only
 * decides a cold start.
 *
 * The name is the contract, not an id -- ids are per-deployment, and the console
 * never sees a HyperDX id. The seeded source set names the landing and
 * detection tables `main` and `hunts` (see
 * api/src/dfe/controllers/org-connection.ts), and the engine registers
 * `all_sources` on every team. A deployment that lands somewhere else sets
 * NEXT_PUBLIC_DFE_DEFAULT_SOURCE or NEXT_PUBLIC_DFE_EMBED_DEFAULT_SOURCE.
 */

import { isEmbedChrome } from '@/dfe/embedFeatures';

/** Empty disables the preference entirely, leaving upstream's ordering. */
const DFE_DEFAULT_SOURCE_NAME =
  process.env.NEXT_PUBLIC_DFE_DEFAULT_SOURCE ?? 'hunts';

/** Tried first in the embed, then the landing table, then the name above. */
const DFE_EMBED_SOURCE_NAME =
  process.env.NEXT_PUBLIC_DFE_EMBED_DEFAULT_SOURCE ?? 'all_sources';

const DFE_LANDING_SOURCE_NAME = 'main';

type NamedSource = { id: string; name?: string };

function findByName(
  sources: readonly NamedSource[],
  name: string,
): string | undefined {
  if (!name) return undefined;

  const wanted = name.toLowerCase();
  return sources.find(s => s.name?.toLowerCase() === wanted)?.id;
}

/**
 * The id of the preferred source, or undefined when this deployment has no
 * source of any of those names -- in which case the caller keeps whatever it
 * would have chosen.
 *
 * `sources` must already be filtered to what the calling page can display, so a
 * preference never selects a source that page would refuse to render.
 */
export function dfePreferredSourceId(
  sources: readonly NamedSource[],
  embed: boolean = isEmbedChrome(),
): string | undefined {
  const preferred = embed
    ? [DFE_EMBED_SOURCE_NAME, DFE_LANDING_SOURCE_NAME, DFE_DEFAULT_SOURCE_NAME]
    : [DFE_DEFAULT_SOURCE_NAME];

  for (const name of preferred) {
    const id = findByName(sources, name);
    if (id) return id;
  }
  return undefined;
}
