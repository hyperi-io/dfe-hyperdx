// DFE legacy-auth lockdown.
//
// In DFE mode the engine is the identity provider and the dfe-ui shell is the
// only login surface. HyperDX's own password login, self-registration and
// invite acceptance each mint a HyperDX session outside the engine's RBAC, so
// they are refused - 404 rather than 403, because in this deployment those
// routes are not on offer at all.
//
// Invite CREATION (POST /team/invitation) is already engine-only through
// requireServicePrincipal on the /team mount. The three routes below live on
// the public root router, which no other middleware sees.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

import { isDfeEnabled } from '@/dfe/config';

// Mounted without auth by packages/api/src/routers/api/root.ts. Matched
// case-insensitively because express routing is case-insensitive by default,
// so /Login/Password reaches the same handler.
const LEGACY_AUTH_ROUTES = [
  /^\/login\/password\/?$/i,
  /^\/register\/password\/?$/i,
  /^\/team\/setup\/[^/]+\/?$/i,
];

/**
 * 404 the legacy password-login, registration and invite-acceptance routes
 * (DFE mode only; a no-op when DFE auth is off, so upstream is unchanged).
 *
 * Mounted app-wide in the DFE block of api-app.ts, ahead of the routers, so
 * `req.path` here is the whole request path.
 */
export function blockLegacyAuthRoutes(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isDfeEnabled) {
    return next();
  }
  if (LEGACY_AUTH_ROUTES.some(route => route.test(req.path))) {
    return res.sendStatus(404);
  }
  return next();
}
