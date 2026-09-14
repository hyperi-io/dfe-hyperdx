// DFE admin-surface lockdown.
//
// HyperDX is embedded-only and driven entirely by the engine. A human uses it
// for search, saved searches, dashboards and charts - nothing else. Every
// administrative surface (connections, sources, team, members, API keys,
// webhooks, alerts, the external /api/v2, and MCP) is reachable ONLY by the
// engine's service identity. These middlewares 403 any non-service principal on
// those surfaces, and are a no-op when DFE auth is off so upstream behaviour and
// tests are unchanged.
//
// Two of them open a narrow, secret-free read instead of refusing outright,
// because the console loads that read on every page.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

import { isDfeEnabled } from '@/dfe/config';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Set true by the engine-JWT middleware for the svc:dfe-engine identity.
      dfeIsServicePrincipal?: boolean;
    }
  }
}

const FORBIDDEN = {
  error: 'This surface is managed by the DFE engine and is not available here.',
};

/** 403 any principal that is not the engine service identity (DFE mode only). */
export function requireServicePrincipal(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isDfeEnabled) {
    return next();
  }
  if (req.dfeIsServicePrincipal) {
    return next();
  }
  return res.status(403).json(FORBIDDEN);
}

/**
 * Let an authenticated human READ but not write: GET/HEAD pass, everything else
 * needs the engine service identity (DFE mode only). Used for /sources -- the
 * embedded search UI must list its own team's sources, and that read is fenced
 * to req.user.team server-side and carries no secrets, so it is safe to open
 * while source CRUD stays engine-only.
 */
export function allowReadElseServicePrincipal(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isDfeEnabled) {
    return next();
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return next();
  }
  if (req.dfeIsServicePrincipal) {
    return next();
  }
  return res.status(403).json(FORBIDDEN);
}

// Fields of the team record that stay engine-only: the API key is a credential,
// and the auth-method policy is the engine's to set.
const TEAM_ADMIN_FIELDS: ReadonlySet<string> = new Set([
  'apiKey',
  'allowedAuthMethods',
]);

/** The team record minus the admin-only fields; anything else passes through. */
function stripTeamAdminFields(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !TEAM_ADMIN_FIELDS.has(key)),
  );
}

/**
 * Let a signed-in member read their own team record without the admin-only
 * fields; the rest of the team surface stays engine-only (DFE mode only).
 *
 * The console loads `GET /team` on every page for one flag, so a blanket 403
 * there logged an error in the browser on a read the lockdown exists to protect
 * WRITES on. Only the record itself opens: members, invitations, tags and the
 * API key surface all keep the 403, as does every mutation.
 */
export function allowTeamReadElseServicePrincipal(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isDfeEnabled || req.dfeIsServicePrincipal) {
    return next();
  }
  // req.path is relative to the /team mount, so '/' is the team record itself.
  if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path !== '/') {
    return res.status(403).json(FORBIDDEN);
  }
  const sendJson = res.json.bind(res);
  res.json = body => sendJson(stripTeamAdminFields(body));
  return next();
}

/**
 * Leave the router when DFE mode is off, so a DFE-only surface does not exist at
 * all in an upstream deployment rather than answering on it.
 */
export function requireDfeMode(
  _req: Request,
  _res: Response,
  next: NextFunction,
) {
  return isDfeEnabled ? next() : next('router');
}

/**
 * Block the ClickHouse connection-tester sub-route while leaving the query proxy
 * open. `POST /clickhouse-proxy/test` probes an arbitrary host/username/password,
 * an admin action, on a mount that must otherwise stay open for query execution.
 */
export function blockClickhouseProxyTest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isDfeEnabled) {
    return next();
  }
  // req.path is relative to the /clickhouse-proxy mount.
  if (req.path === '/test' && !req.dfeIsServicePrincipal) {
    return res.status(403).json(FORBIDDEN);
  }
  return next();
}
