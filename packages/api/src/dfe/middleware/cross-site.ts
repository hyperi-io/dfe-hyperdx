// DFE cross-site protection for the state-changing DFE routes.
//
// A form post is a SIMPLE request: it needs no CORS preflight and carries no
// header the posting page had to be allowed to set, so a hostile page can aim
// one at this API and the browser attaches the caller's cookies. Requiring
// either a same-origin `Origin` or an `X-Requested-With` header makes the
// request non-simple, which a cross-site form cannot produce.
//
// It is the second layer, not the only one. dfe-ui plants the engine token in a
// `dfe_token` cookie (apps/dfe-core-ui/src/proxy.ts) with HttpOnly, Path=/,
// SameSite=Lax, Secure whenever the UI is served over https, and Domain set to
// DFE_COOKIE_DOMAIN so it reaches the embedded HyperDX subdomain. SameSite=Lax
// already keeps that cookie off a cross-site POST; this holds when a deployment
// authenticates some other way.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const FORBIDDEN = {
  error:
    'This request must carry a matching Origin or an X-Requested-With header.',
};

/** True when `origin` names the same host the request was addressed to. */
function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (!host) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    // A malformed Origin is not a match.
    return false;
  }
}

/** 403 a state-changing request a cross-site page could have produced. */
export function requireNonSimpleRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }
  if (req.get('x-requested-with')) {
    return next();
  }
  const origin = req.get('origin');
  if (origin && isSameOrigin(origin, req.get('host'))) {
    return next();
  }
  return res.status(403).json(FORBIDDEN);
}
