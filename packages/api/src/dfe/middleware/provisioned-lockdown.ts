// DFE provisioned-dashboard lockdown.
//
// A provisioned dashboard is owned by the DFE release, not the team. The
// provisioner reconciles on a one-minute cron and $sets tiles, so an edit here
// would be reverted within 60s with no error shown. Modifications are refused,
// and a user takes their own editable copy with the Duplicate action.
//
// DELETE is allowed and tombstoned: the provisioner skips a name this team has
// deleted, so the delete sticks until the team restores the shipped set. A
// session whose role is neither admin nor owner is refused it (see
// dfe/middleware/role-claim).
//
// GET is untouched, and so is every non-provisioned dashboard.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

import { isDfeEnabled } from '@/dfe/config';
import { dfeRoleRefuses, ROLE_FORBIDDEN } from '@/dfe/middleware/role-claim';
import { recordDashboardTombstone } from '@/dfe/models/dashboard-tombstone';
import Dashboard from '@/models/dashboard';
import logger from '@/utils/logger';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const FORBIDDEN = {
  error:
    'This dashboard is managed by DFE and is replaced on upgrade. Duplicate it to make your own editable copy.',
};

/**
 * Refuse a modification aimed at a provisioned dashboard, and tombstone a
 * delete of one (DFE mode only).
 *
 * Mounted on the dashboards router, so it sees `/:id` for PATCH and DELETE. A
 * request with no id in the path is a create and is always allowed.
 */
export async function blockProvisionedWrites(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isDfeEnabled || READ_METHODS.has(req.method)) {
    return next();
  }

  // The router mounts these as `/:id`, so the id is the first path segment.
  const id = req.path.split('/').filter(Boolean)[0];
  if (!id) {
    return next();
  }

  let provisioned: { name: string; team: unknown } | null = null;
  try {
    provisioned = await Dashboard.findOne(
      { _id: id, provisioned: true },
      'name team',
    ).lean();
  } catch (err) {
    // A malformed id is not this middleware's error to report; the route's own
    // validation returns the right message.
    logger.debug({ err, id }, 'DFE: provisioned lookup skipped');
    return next();
  }

  if (!provisioned) {
    return next();
  }

  if (req.method !== 'DELETE') {
    return res.status(403).json(FORBIDDEN);
  }

  // A delete removes the dashboard for the whole team, so a role that is not a
  // team-admin one refuses it.
  if (dfeRoleRefuses(req)) {
    return res.status(403).json(ROLE_FORBIDDEN);
  }

  const { name, team } = provisioned;
  // Recorded on the way out so a route that failed to delete leaves no tombstone.
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      return;
    }
    recordDashboardTombstone(name, String(team)).catch(err => {
      logger.error(
        { err, name },
        'DFE: failed to tombstone a deleted shipped dashboard',
      );
    });
  });

  return next();
}
