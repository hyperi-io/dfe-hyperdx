// DFE Team Provisioning
// Find-or-create teams from OIDC group claims.
// This is a NEW controller — it does not modify any upstream HyperDX files.

import * as dfeConfig from '@/dfe/config';
import Team from '@/models/team';
import { setupTeamDefaults } from '@/setupDefaults';
import logger from '@/utils/logger';

/**
 * Find an existing team by name, or create a new one.
 * When a new team is created, setupTeamDefaults() is called to provision
 * default ClickHouse connections and sources.
 */
export async function findOrCreateTeamByName(name: string) {
  let team = await Team.findOne({ name });

  if (team) {
    return { team, created: false };
  }

  team = new Team({ name });
  await team.save();

  logger.info({ teamId: team._id, teamName: name }, 'DFE: created new team');

  // In oidc-proxy mode the team's connection is seeded per team by the identity
  // middleware from the engine (one connection per team), so the global
  // DEFAULT_CONNECTIONS blob is skipped here - seeding it would hand every team
  // every org's connection. Header-dev and upstream keep the global seeding.
  if (dfeConfig.DFE_AUTH_MODE !== 'oidc-proxy') {
    try {
      await setupTeamDefaults(team._id.toString());
    } catch (err) {
      logger.warn(
        { teamId: team._id, err },
        'DFE: failed to setup team defaults (non-fatal)',
      );
    }
  }

  return { team, created: true };
}

/**
 * Find a team by its MongoDB ObjectId.
 * Unlike the upstream getTeam() which does Team.findOne({}),
 * this always filters by _id.
 */
export async function getTeamById(teamId: string) {
  return Team.findById(teamId);
}
