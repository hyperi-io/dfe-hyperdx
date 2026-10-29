// DFE role - who may change what the whole team sees.
//
// Deleting or restoring a shipped dashboard changes it for every member, so only
// the `admin` and `owner` roles may. jwt-verify takes the role from the engine's
// `hyperdx_role` on GET /api/v1/auth/me, resolved from the account's groups and
// cached for 30 seconds, and falls back to the token's `role` claim for an engine
// that sends no `hyperdx_role`.
//
// The check is gated on the role's PRESENCE: a session with none (an engine that
// issues neither, or header-dev) keeps team membership as the whole authorisation.
//
// The engine's `viewer` role is read-only: it may query and read, and every
// other write it sends is refused (refuseReadOnlyWrites).
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

import { isDfeEnabled } from '@/dfe/config';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // The engine's `hyperdx_role` for the session, else the token's `role` claim.
      dfeRole?: string;
    }
  }
}

/** The roles allowed to change what the whole team sees. */
const TEAM_ADMIN_ROLES: ReadonlySet<string> = new Set(['admin', 'owner']);

export const ROLE_FORBIDDEN = {
  error: 'Changing the shipped dashboards needs the admin or owner role.',
};

/**
 * True when the caller carries a role that is not a team-admin one.
 *
 * A missing role is not a refusal - see the module note.
 */
export function dfeRoleRefuses(req: Request): boolean {
  if (!isDfeEnabled) {
    return false;
  }
  const role = req.dfeRole;
  if (!role) {
    return false;
  }
  return !TEAM_ADMIN_ROLES.has(role.toLowerCase());
}

/** 403 a caller whose role is present and is neither admin nor owner. */
export function requireTeamAdminRole(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (dfeRoleRefuses(req)) {
    return res.status(403).json(ROLE_FORBIDDEN);
  }
  return next();
}

/** The role the engine hands an account that may read and query but change nothing. */
const READ_ONLY_ROLE = 'viewer';

const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

// The writes a read-only session keeps: running a query, the caller's own
// favourites and profile, and the rule export the engine authorises itself.
// Anything else, a route upstream adds included, is refused.
const READ_ONLY_ALLOWED: readonly RegExp[] = [
  /^\/clickhouse-proxy(\/|$)/i,
  /^\/v1\/prometheus\//i,
  /^\/ai\/assistant\/?$/i,
  /^\/dfe\/(export-sql|create-rule)\/?$/i,
  /^\/favorites(\/|$)/i,
  /^\/me(\/|$)/i,
];

export const READ_ONLY_FORBIDDEN = {
  error: 'Your role is read-only, so it cannot change this.',
};

/** True when the caller carries the engine's read-only role. */
export function dfeRoleIsReadOnly(req: Request): boolean {
  if (!isDfeEnabled) {
    return false;
  }
  return req.dfeRole?.toLowerCase() === READ_ONLY_ROLE;
}

/**
 * 403 a read-only session's write, outside READ_ONLY_ALLOWED.
 *
 * Runs app-wide behind the identity middleware, so `req.path` is the whole
 * request path, matched case-insensitively as express routes it.
 */
export function refuseReadOnlyWrites(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (READ_METHODS.has(req.method) || !dfeRoleIsReadOnly(req)) {
    return next();
  }
  if (READ_ONLY_ALLOWED.some(route => route.test(req.path))) {
    return next();
  }
  return res.status(403).json(READ_ONLY_FORBIDDEN);
}
