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
