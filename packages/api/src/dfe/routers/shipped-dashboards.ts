// DFE shipped-dashboard restore.
//
// Deleting a shipped dashboard writes a tombstone (dfe/middleware/
// provisioned-lockdown), which the provisioner honours forever. This is the way
// back: clear the team's tombstones and run one provisioning pass inside the
// request, so the dashboards are present again by the time it returns rather
// than up to a minute later.
//
// Team membership is the authorisation until the engine issues a role claim; see
// dfe/middleware/role-claim for what happens the day it does.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import express from 'express';
import fs from 'fs';

import { requireDfeMode } from '@/dfe/middleware/admin-lockdown';
import { requireNonSimpleRequest } from '@/dfe/middleware/cross-site';
import { requireTeamAdminRole } from '@/dfe/middleware/role-claim';
import { clearDashboardTombstones } from '@/dfe/models/dashboard-tombstone';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { syncDashboards } from '@/tasks/provisionDashboards';
import logger from '@/utils/logger';

const router = express.Router();

// The restore surface is DFE's, so outside DFE mode it is not there at all.
router.use(requireDfeMode);

/**
 * POST /dfe/dashboards/restore-shipped
 *
 * Reprovisioning is team-wide, so the request must be one a cross-site page
 * cannot forge and the caller's role claim, when there is one, must allow it.
 *
 * Response:
 *   - cleared: number (tombstones removed)
 *   - reprovisioned: boolean (false when no provisioner directory is mounted)
 */
router.post(
  '/dashboards/restore-shipped',
  requireNonSimpleRequest,
  requireTeamAdminRole,
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const team = String(teamId);

      const cleared = await clearDashboardTombstones(team);

      const dir = process.env.DASHBOARD_PROVISIONER_DIR;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator config from the environment, never request input
      const reprovisioned = Boolean(dir && fs.existsSync(dir));
      if (dir && reprovisioned) {
        await syncDashboards(
          team,
          dir,
          process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS === 'true',
        );
      }

      logger.info(
        { team, cleared, reprovisioned },
        'DFE: shipped set restored',
      );
      return res.json({ cleared, reprovisioned });
    } catch (err) {
      logger.error({ err }, 'DFE: restore-shipped failed');
      next(err);
    }
  },
);

export default router;
