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
// Both checks fail closed: a write is refused when the store cannot say whether
// the dashboard is shipped, or cannot record the tombstone of a delete.
//
// GET is untouched, and so is every non-provisioned dashboard.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';

import { isDfeEnabled } from '@/dfe/config';
import { dfeRoleRefuses, ROLE_FORBIDDEN } from '@/dfe/middleware/role-claim';
import {
  recordDashboardTombstone,
  removeDashboardTombstone,
} from '@/dfe/models/dashboard-tombstone';
import Dashboard from '@/models/dashboard';
import logger from '@/utils/logger';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const FORBIDDEN = {
  error:
    'This dashboard is managed by DFE and is replaced on upgrade. Duplicate it to make your own editable copy.',
};

const UNAVAILABLE = {
  error:
    'DFE could not reach its store to check this dashboard change. Try again shortly.',
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

  // The router mounts these as `/:id` and express decodes the param, so the id
  // is the first path segment decoded. The router refuses a malformed escape itself.
  const segment = req.path.split('/').filter(Boolean)[0];
  let id: string | undefined;
  try {
    id = segment === undefined ? undefined : decodeURIComponent(segment);
  } catch {
    return next();
  }
  // BSON drops an undefined team from the filter, which would then match every
  // team's dashboard.
  const callerTeam = req.user?.team;
  // An id that is no ObjectId names no dashboard: the `/:id` routes answer it
  // 400 through objectIdSchema, and the other paths are not dashboard ids.
  if (!id || !callerTeam || !Types.ObjectId.isValid(id)) {
    return next();
  }

  let provisioned: { name: string; team: unknown } | null = null;
  try {
    // Scoped to the caller's team, so another team's dashboard is answered as a
    // missing one.
    provisioned = await Dashboard.findOne(
      { _id: id, provisioned: true, team: callerTeam },
      'name team',
    ).lean();
  } catch (err) {
    logger.error({ err, id }, 'DFE: provisioned lookup failed, write refused');
    return res.status(503).json(UNAVAILABLE);
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
  // Recorded before the route deletes, so a delete answered 204 is already
  // tombstoned and the next provisioning pass cannot bring it back.
  let created: boolean;
  try {
    created = await recordDashboardTombstone(name, String(team));
  } catch (err) {
    logger.error(
      { err, name },
      'DFE: failed to tombstone a shipped dashboard, delete refused',
    );
    return res.status(503).json(UNAVAILABLE);
  }

  // A delete the route failed takes back the tombstone this request wrote.
  if (created) {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        return;
      }
      removeDashboardTombstone(name, String(team)).catch(err => {
        logger.error(
          { err, name },
          'DFE: failed to remove the tombstone of a dashboard that was not deleted',
        );
      });
    });
  }

  return next();
}
