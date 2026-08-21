// DFE provisioned-dashboard lockdown.
//
// A provisioned dashboard is owned by the DFE release, not the team. The
// provisioner reconciles on a one-minute cron and $sets tiles, so an edit here
// would be reverted within 60s with no error shown. Writes are refused instead,
// and a user takes their own copy via Export Dashboard -> Import Dashboard, which
// lands a normal editable dashboard they own.
//
// GET is untouched, and so is every non-provisioned dashboard.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

import { isDfeEnabled } from '@/dfe/config';
import Dashboard from '@/models/dashboard';
import logger from '@/utils/logger';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const FORBIDDEN = {
  error:
    'This dashboard is managed by DFE and is replaced on upgrade. Duplicate it to make your own editable copy.',
};

/**
 * 403 a write aimed at a provisioned dashboard (DFE mode only).
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

  try {
    const provisioned = await Dashboard.exists({ _id: id, provisioned: true });
    if (provisioned) {
      return res.status(403).json(FORBIDDEN);
    }
  } catch (err) {
    // A malformed id is not this middleware's error to report; the route's own
    // validation returns the right message.
    logger.debug({ err, id }, 'DFE: provisioned lookup skipped');
  }

  return next();
}
