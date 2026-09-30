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
