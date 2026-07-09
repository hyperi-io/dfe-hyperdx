/**
 * DFE embed feature allowlist.
 *
 * The DFE embed UI exposes ONLY these features. Everything else is hidden from the
 * nav AND route-blocked (not reachable by direct URL) -- gating is enforced at the
 * router (see dfeRouteGuard), not just by hiding nav items, so a user who knows a
 * URL still cannot reach a disabled feature.
 *
 * Static for now; this is the seam that later reads the engine's embed config
 * (/api/v1/ui/hyperdx-embed) so an operator can turn features on/off per deployment.
 */
export const DFE_EMBED_FEATURES: ReadonlySet<string> = new Set([
  'search', // Search (logs/events)
  'saved-searches', // Saved Searches
  'chart', // Chart Explorer
  'dashboards', // Dashboards
]);

export function isEmbedFeatureEnabled(id: string): boolean {
  return DFE_EMBED_FEATURES.has(id);
}

/**
 * Route prefixes for DISABLED features. A direct navigation to any of these is
 * redirected to /search by the route guard. Keep in sync with the disabled set
 * above (these are the routes those features own).
 */
export const DFE_BLOCKED_ROUTE_PREFIXES: readonly string[] = [
  '/alerts',
  '/sessions', // Client Sessions
  '/service-map',
  '/team', // Team Settings
];

/** True if `pathname` belongs to a blocked (disabled) feature. */
export function isBlockedRoute(pathname: string): boolean {
  return DFE_BLOCKED_ROUTE_PREFIXES.some(
    p => pathname === p || pathname.startsWith(p + '/'),
  );
}

/**
 * Embed (chromeless) mode. When DFE embeds this fork as a seamless sibling in
 * dfe-ui (an iframe), dfe-ui owns the nav -- hyperdx must render NO chrome (no
 * AppNav) so there is a single nav, not two. Triggered by `?embed=1` on the URL;
 * persisted in sessionStorage so internal hyperdx navigation stays chromeless.
 * Standalone (direct) access has no flag -> keeps the gated nav.
 */
export function isEmbedChrome(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('embed') === '1') {
      window.sessionStorage.setItem('dfeEmbed', '1');
      return true;
    }
    return window.sessionStorage.getItem('dfeEmbed') === '1';
  } catch {
    return false;
  }
}

/**
 * The experimental CHART AI Assistant (Chart Explorer) is OFF by default in DFE. It
 * hides the whole component -- including the "Experimental" teaser bar -- independent
 * of the per-user `me.aiAssistantEnabled` flag. Opt in per deployment with
 * NEXT_PUBLIC_DFE_CHART_AI_ASSISTANT=true (NEXT_PUBLIC_ so it is client-side).
 * NB: named CHART-specific because DFE is adding general AI assistants separately.
 */
export const DFE_CHART_AI_ASSISTANT_ENABLED =
  process.env.NEXT_PUBLIC_DFE_CHART_AI_ASSISTANT === 'true';
