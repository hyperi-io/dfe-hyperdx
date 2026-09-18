// DFE role claim - enforced only once the engine issues one.
//
// Team membership is today's whole authorisation for deleting and restoring the
// shipped dashboards: the engine JWT carries `sub` and `groups`, groups select
// the team, and there is no role to gate on. A read-only console account is a
// team member like any other, so it can delete a shipped dashboard team-wide.
//
// The check is gated on the claim's PRESENCE. A token without one keeps today's
// behaviour exactly, and a deployment starts refusing non-admins the moment the
// engine issues the claim - no release has to land in step with the other.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

import { isDfeEnabled } from '@/dfe/config';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Set from the engine JWT's `role` claim, when the token carries one.
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
 * True when the caller carries a role claim that is not a team-admin one.
 *
 * A missing claim is not a refusal - see the module note.
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

/** 403 a caller whose role claim is present and is neither admin nor owner. */
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
