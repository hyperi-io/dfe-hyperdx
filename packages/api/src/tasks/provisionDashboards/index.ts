import {
  DashboardWithoutId,
  DashboardWithoutIdSchema,
  resolveChartPaletteToken,
  walkRawDashboardTileColors,
} from '@hyperdx/common-utils/dist/types';
import fs from 'fs';
import path from 'path';

import { getConnectionsByTeam } from '@/controllers/connection';
import { getSources } from '@/controllers/sources';
import { connectDB, mongooseConnection } from '@/models';
import Dashboard from '@/models/dashboard';
import Team from '@/models/team';
import type { HdxTask } from '@/tasks/types';
import { ProvisionDashboardsTaskArgs } from '@/tasks/types';
import logger from '@/utils/logger';

// Heal legacy `chart-1`..`chart-10` tile colors from #2265 before the
// strict `DashboardWithoutIdSchema` parse rejects them. Same policy as
// the React `normalizeDashboardTileColors` and the API router's
// `migrateLegacyDashboardTileColors`: hue tokens pass through, legacy
// numeric tokens are rewritten to hue-named equivalents, and unknown
// strings are left intact so the schema's native enum error surfaces
// in the warn log instead of silently dropping the field.
function migrateLegacyDashboardTileColorsRaw(raw: unknown): unknown {
  return walkRawDashboardTileColors(raw, current => {
    const resolved = resolveChartPaletteToken(current);
    return resolved ?? current;
  });
}

export function readDashboardFiles(dir: string): DashboardWithoutId[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch (err) {
    logger.error({ err, dir }, 'Failed to read dashboard directory');
    return [];
  }

  const dashboards: DashboardWithoutId[] = [];
  for (const file of files) {
    try {
      const raw = migrateLegacyDashboardTileColorsRaw(
        JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')),
      ) as Record<string, unknown> | null | undefined;
      const parsed = DashboardWithoutIdSchema.safeParse({
        tags: [],
        ...(raw as object),
      });
      if (!parsed.success) {
        logger.warn(
          { file, errors: parsed.error.issues },
          'Skipping invalid dashboard file',
        );
        continue;
      }
      dashboards.push(parsed.data);
    } catch (err) {
      logger.error({ err, file }, 'Failed to parse dashboard file');
    }
  }
  return dashboards;
}

interface NamedRef {
  id: string;
  name: string;
}

/**
 * Resolve a tile or filter's source/connection reference to an id.
 *
 * An id is returned unchanged, so id-based files keep working. Otherwise the
 * reference is matched against names case-insensitively, the same match the
 * import UI performs (`DBDashboardImportPage`). Returns undefined when neither
 * matches.
 */
function resolveRef(ref: string, refs: NamedRef[]): string | undefined {
  if (refs.some(r => r.id === ref)) {
    return ref;
  }
  const lowered = ref.toLowerCase();
  return refs.find(r => r.name.toLowerCase() === lowered)?.id;
}

/**
 * Rewrite a dashboard's source and connection references to ids for one team.
 *
 * An unresolvable reference is passed through unchanged, matching the previous
 * behaviour of writing files verbatim. Set `requireResolvable` to skip the
 * dashboard instead, which suits a directory provisioned to every team: a
 * dashboard naming a source only some teams hold is then seeded only to those
 * teams rather than to all of them with dead tiles.
 *
 * Exported so a provisioned file can be checked against a team without writing.
 */
export function resolveDashboardRefs(
  dashboard: DashboardWithoutId,
  sources: NamedRef[],
  connections: NamedRef[],
  requireResolvable = false,
): DashboardWithoutId | undefined {
  const resolved = structuredClone(dashboard);
  let unresolved: string | undefined;

  const rewrite = (
    holder: { source?: string; connection?: string },
    key: 'source' | 'connection',
    refs: NamedRef[],
  ) => {
    const ref = holder[key];
    if (!ref) {
      return;
    }
    const id = resolveRef(ref, refs);
    if (!id) {
      unresolved ??= `${key}:${ref}`;
      return;
    }
    holder[key] = id;
  };

  for (const tile of resolved.tiles) {
    const config = tile.config as { source?: string; connection?: string };
    rewrite(config, 'source', sources);
    rewrite(config, 'connection', connections);
  }

  for (const filter of resolved.filters ?? []) {
    rewrite(filter, 'source', sources);
  }

  if (unresolved) {
    logger.warn(
      { name: dashboard.name, unresolved, requireResolvable },
      'Dashboard reference did not match any of the team’s sources or connections',
    );
    if (requireResolvable) {
      return undefined;
    }
  }

  return resolved;
}

export async function syncDashboards(
  teamId: string,
  dir: string,
  requireResolvable = false,
) {
  const rawDashboards = readDashboardFiles(dir);
  if (rawDashboards.length === 0) return;

  const [teamSources, teamConnections] = await Promise.all([
    getSources(teamId),
    getConnectionsByTeam(teamId),
  ]);
  const sources: NamedRef[] = teamSources.map(s => ({
    id: String(s.id ?? s._id),
    name: s.name,
  }));
  const connections: NamedRef[] = teamConnections.map(c => ({
    id: String(c.id ?? c._id),
    name: c.name,
  }));

  const dashboards = rawDashboards
    .map(d => resolveDashboardRefs(d, sources, connections, requireResolvable))
    .filter((d): d is DashboardWithoutId => d !== undefined);

  for (const dashboard of dashboards) {
    try {
      const userDashboard = await Dashboard.exists({
        name: dashboard.name,
        team: teamId,
        provisioned: { $ne: true },
      });
      if (userDashboard) {
        logger.warn(
          { name: dashboard.name },
          'A user-created dashboard with this name already exists, provisioned copy will coexist',
        );
      }

      const result = await Dashboard.findOneAndUpdate(
        { name: dashboard.name, team: teamId, provisioned: true },
        {
          $set: {
            tiles: dashboard.tiles || [],
            tags: dashboard.tags || [],
            filters: dashboard.filters || [],
            savedQuery: dashboard.savedQuery ?? null,
            savedQueryLanguage: dashboard.savedQueryLanguage ?? null,
            savedFilterValues: dashboard.savedFilterValues || [],
            containers: dashboard.containers || [],
          },
          $setOnInsert: {
            name: dashboard.name,
            team: teamId,
            provisioned: true,
          },
        },
        { upsert: true, new: false },
      );

      if (result === null) {
        logger.info({ name: dashboard.name }, 'Created provisioned dashboard');
      }
    } catch (err) {
      logger.error(
        { err, name: dashboard.name },
        'Failed to provision dashboard',
      );
    }
  }
}

export default class ProvisionDashboardsTask
  implements HdxTask<ProvisionDashboardsTaskArgs>
{
  constructor(private args: ProvisionDashboardsTaskArgs) {}

  name(): string {
    return this.args.taskName;
  }

  async execute(): Promise<void> {
    await connectDB();

    const dir = process.env.DASHBOARD_PROVISIONER_DIR;
    if (!dir) {
      throw new Error(
        'DASHBOARD_PROVISIONER_DIR environment variable is required',
      );
    }

    const teamId = process.env.DASHBOARD_PROVISIONER_TEAM_ID;
    const provisionAllTeams =
      process.env.DASHBOARD_PROVISIONER_ALL_TEAMS === 'true';

    if (teamId && provisionAllTeams) {
      logger.warn(
        'Both DASHBOARD_PROVISIONER_TEAM_ID and DASHBOARD_PROVISIONER_ALL_TEAMS are set, using TEAM_ID',
      );
    }

    if (!teamId && !provisionAllTeams) {
      throw new Error(
        'DASHBOARD_PROVISIONER_TEAM_ID is required (or set DASHBOARD_PROVISIONER_ALL_TEAMS=true)',
      );
    }

    if (teamId && !/^[0-9a-fA-F]{24}$/.test(teamId)) {
      throw new Error(
        `DASHBOARD_PROVISIONER_TEAM_ID is not a valid ObjectId: ${teamId}`,
      );
    }

    if (!fs.existsSync(dir)) {
      logger.warn({ dir }, 'Dashboard provisioner directory does not exist');
      return;
    }

    let teamIds: string[];
    if (teamId) {
      const teamExists = await Team.exists({ _id: teamId });
      if (!teamExists) {
        logger.warn(
          { teamId },
          'Configured team does not exist, skipping sync',
        );
        return;
      }
      teamIds = [teamId];
    } else {
      const teams = await Team.find().select('_id').lean();
      teamIds = teams.map(t => t._id.toString());
    }

    // Off by default so a directory of id-based dashboards keeps provisioning
    // exactly as before. On, a dashboard naming a source the team does not hold
    // is skipped for that team instead of being written with dead tiles.
    const requireResolvable =
      process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS === 'true';

    for (const id of teamIds) {
      await syncDashboards(id, dir, requireResolvable);
    }
  }

  async asyncDispose(): Promise<void> {
    await mongooseConnection.close();
  }
}
