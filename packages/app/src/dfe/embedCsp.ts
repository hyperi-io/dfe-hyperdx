/**
 * DFE embed: who may put this app in an iframe.
 *
 * hyperdx is iframed by dfe-ui as a seamless sibling, and upstream's blanket
 * X-Frame-Options: DENY blocks all framing, so a CSP frame-ancestors allowlist
 * carries the policy instead -- only the DFE UI origin(s) may frame this app,
 * and clickjacking protection remains against everyone else.
 *
 * The header is composed per request in proxy.ts, not in next.config.mjs
 * `headers()`, which Next evaluates during `next build` where a deployment's
 * DFE_EMBED_FRAME_ANCESTORS is not yet set.
 */

export const EMBED_CSP_HEADER = 'Content-Security-Policy';

/**
 * The frame-ancestors policy for this deployment, from the space-separated
 * DFE_EMBED_FRAME_ANCESTORS allowlist.
 *
 * The default argument is read on every call, so a restart with a different
 * value changes the header without a rebuild.
 */
export function embedFrameAncestors(
  origins: string | undefined = process.env.DFE_EMBED_FRAME_ANCESTORS,
): string {
  const extra = origins?.trim();
  return extra ? `frame-ancestors 'self' ${extra}` : "frame-ancestors 'self'";
}
