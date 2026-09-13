// DFE shipped-dashboard restore.
//
// Deleting a shipped dashboard writes a tombstone (dfe/middleware/
// provisioned-lockdown), which the provisioner honours forever. This is the way
// back: clear the team's tombstones and run one provisioning pass inside the
// request, so the dashboards are present again by the time it returns rather
// than up to a minute later.
//
// Team membership is the whole authorisation: the engine JWT carries `sub` and
// `groups`, and groups select the team - no role claim exists to gate on.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import express from 'express';
import fs from 'fs';

import { clearDashboardTombstones } from '@/dfe/models/dashboard-tombstone';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { syncDashboards } from '@/tasks/provisionDashboards';
import logger from '@/utils/logger';

const router = express.Router();

/**
 * POST /dfe/dashboards/restore-shipped
 *
 * Response:
 *   - cleared: number (tombstones removed)
 *   - reprovisioned: boolean (false when no provisioner directory is mounted)
 */
router.post('/dashboards/restore-shipped', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const team = String(teamId);

    const cleared = await clearDashboardTombstones(team);

    const dir = process.env.DASHBOARD_PROVISIONER_DIR;
    const reprovisioned = Boolean(dir && fs.existsSync(dir));
    if (dir && reprovisioned) {
      await syncDashboards(
        team,
        dir,
        process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS === 'true',
      );
    }

    logger.info({ team, cleared, reprovisioned }, 'DFE: shipped set restored');
    return res.json({ cleared, reprovisioned });
  } catch (err) {
    logger.error({ err }, 'DFE: restore-shipped failed');
    next(err);
  }
});

export default router;
