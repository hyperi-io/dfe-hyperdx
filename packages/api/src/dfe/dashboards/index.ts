// DFE dashboard seeding.
//
// Seeds the pre-canned dashboards onto a team at the same moment its connection
// and sources are created, so a deploy lands able to watch itself instead of
// handing every operator an empty search box.
//
// Reuses the upstream provisioner's `syncDashboards` write path (upsert on
// name + team + provisioned, never clobbering a user dashboard of the same name)
// rather than adding a second writer.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import { DashboardWithoutId } from '@hyperdx/common-utils/dist/types';

import Dashboard from '@/models/dashboard';
import logger from '@/utils/logger';

import {
  buildPlatformDashboard,
  buildThroughputDashboard,
} from './definitions';

// Source names as seeded by ensureOrgConnection. Kept here so a rename there
// fails a test rather than silently seeding a dashboard with no data.
export const SOURCE_DEFAULT = 'default';
export const SOURCE_OTEL_METRICS = 'otel_metrics';
export const SOURCE_OTEL_LOGS = 'otel_logs';

export type SourceIdsByName = Map<string, string>;

/**
 * Build the dashboards a team should hold.
 *
 * Every team gets Throughput, over the `default` source alone. The platform team
 * additionally gets the overview, which reads otel_* sources a tenant team does
 * not have - seeding it to a tenant would leave tiles pointing at a source id
 * that does not exist for them.
 */
export function dashboardsForTeam(
  sourceIds: SourceIdsByName,
  isPlatform: boolean,
): DashboardWithoutId[] {
  const dashboards: DashboardWithoutId[] = [];

  const defaultSource = sourceIds.get(SOURCE_DEFAULT);
  if (defaultSource) {
    dashboards.push(buildThroughputDashboard(defaultSource));
  }

  if (isPlatform) {
    const metrics = sourceIds.get(SOURCE_OTEL_METRICS);
    const logs = sourceIds.get(SOURCE_OTEL_LOGS);
    if (metrics && logs) {
      dashboards.push(buildPlatformDashboard(metrics, logs));
    }
  }

  return dashboards;
}

/**
 * Upsert the built dashboards onto a team.
 *
 * Idempotent on (name, team, provisioned): re-running updates the tiles of the
 * provisioned copy and leaves any same-named user dashboard alone. Non-fatal by
 * design - a HyperDX login is never blocked on dashboard seeding.
 */
export async function seedTeamDashboards(
  teamId: string,
  sourceIds: SourceIdsByName,
  isPlatform: boolean,
): Promise<void> {
  const dashboards = dashboardsForTeam(sourceIds, isPlatform);
  if (dashboards.length === 0) {
    return;
  }

  for (const dashboard of dashboards) {
    try {
      await Dashboard.findOneAndUpdate(
        { name: dashboard.name, team: teamId, provisioned: true },
        {
          $set: {
            tiles: dashboard.tiles ?? [],
            tags: dashboard.tags ?? [],
          },
          $setOnInsert: {
            name: dashboard.name,
            team: teamId,
            provisioned: true,
          },
        },
        { upsert: true, new: false },
      );
      logger.info(
        { teamId, name: dashboard.name },
        'DFE: seeded provisioned dashboard',
      );
    } catch (err) {
      logger.warn(
        { err, teamId, name: dashboard.name },
        'DFE: dashboard seeding failed (non-fatal)',
      );
    }
  }
}
