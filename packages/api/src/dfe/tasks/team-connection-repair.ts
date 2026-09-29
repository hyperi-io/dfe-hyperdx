// DFE team-connection repair, run once per process at startup.
//
// Teams used to be named after an IdP group and seeded with the connection of
// whichever member arrived first, so a team could hold a ClickHouse user wider
// than some of its members were handed. A team is now named after the
// ClickHouse user it connects as, so any connection whose username is not its
// team's name is one of those, and this deletes it. Members move onto their own
// identity team on their next request; the old team's dashboards, saved
// searches and sources are left where they are. Operator evidence queries:
// docs/architecture/team-identity.md.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import * as dfeConfig from '@/dfe/config';
import { ensureOneConnectionPerTeam } from '@/dfe/controllers/org-connection';
import { mongooseConnection } from '@/models';
import Alert from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Team from '@/models/team';
import User from '@/models/user';
import logger from '@/utils/logger';

// mongoose's readyState for an open connection.
const CONNECTED = 1;

export type RepairReport = {
  checked: number;
  deleted: number;
};

/**
 * Delete every connection whose username is not its team's name, logging each
 * one and the content its team still holds. Never touches users or content.
 */
export async function repairTeamConnections(): Promise<RepairReport> {
  const teams = await Team.find({}, 'name').lean();
  const teamNames = new Map(teams.map(team => [String(team._id), team.name]));
  // The password is select:false on the model, and the projection leaves it out regardless.
  const connections = await Connection.find({}, 'team username').lean();

  const emptied = new Set<string>();
  let deleted = 0;
  for (const connection of connections) {
    const teamId = String(connection.team);
    const team = teamNames.get(teamId);
    if (team !== undefined && connection.username === team) {
      continue;
    }
    const members = await User.countDocuments({ team: connection.team });
    logger.warn(
      {
        teamId,
        team: team ?? null,
        username: connection.username,
        connectionId: String(connection._id),
        members,
      },
      'DFE: deleting a team connection that is not the team identity',
    );
    await Connection.deleteOne({ _id: connection._id });
    deleted += 1;
    if (team !== undefined) {
      emptied.add(teamId);
    }
  }

  for (const teamId of emptied) {
    const [sources, savedSearches, dashboards, alerts] = await Promise.all([
      Source.countDocuments({ team: teamId }),
      SavedSearch.countDocuments({ team: teamId }),
      Dashboard.countDocuments({ team: teamId }),
      Alert.countDocuments({ team: teamId }),
    ]);
    logger.info(
      {
        teamId,
        team: teamNames.get(teamId),
        sources,
        savedSearches,
        dashboards,
        alerts,
      },
      'DFE: team left without a connection keeps its content',
    );
  }

  await ensureOneConnectionPerTeam();
  logger.info(
    { checked: connections.length, deleted },
    'DFE: team connection repair complete',
  );
  return { checked: connections.length, deleted };
}

/**
 * Run the repair once, as soon as Mongo is connected (oidc-proxy mode only).
 *
 * A failure is logged and not retried. Sessions stay fenced without it: each
 * lands on the team named after its own identity, and ensureOrgConnection
 * refuses one whose team holds any other ClickHouse user.
 */
export function scheduleTeamConnectionRepair(): void {
  if (dfeConfig.DFE_AUTH_MODE !== 'oidc-proxy') {
    return;
  }
  const run = () => {
    repairTeamConnections().catch(err => {
      logger.error({ err }, 'DFE: team connection repair failed');
    });
  };
  if (mongooseConnection.readyState === CONNECTED) {
    run();
    return;
  }
  mongooseConnection.once('connected', run);
}
