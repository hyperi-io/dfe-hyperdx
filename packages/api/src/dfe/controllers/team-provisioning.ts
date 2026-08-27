// DFE Team Provisioning
// Find-or-create teams from OIDC group claims.
// This is a NEW controller — it does not modify any upstream HyperDX files.

import * as dfeConfig from '@/dfe/config';
import Team from '@/models/team';
import { setupTeamDefaults } from '@/setupDefaults';
import logger from '@/utils/logger';

// MongoDB duplicate-key error code, raised when two concurrent inserts collide
// on the unique `name` index. FerretDB surfaces the same code.
const DUPLICATE_KEY = 11000;

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY
  );
}

// Team name is the OIDC group / org identity here, so it must be unique. The
// constraint is what makes find-or-create race-safe (a concurrent create
// collides on it). Ensured from the dfe layer - idempotent createIndex - so the
// upstream Team model stays pristine and off the fork conflict surface.
let nameIndexEnsured = false;

async function ensureUniqueNameIndex(): Promise<void> {
  if (nameIndexEnsured) {
    return;
  }
  nameIndexEnsured = true;
  try {
    await Team.collection.createIndex({ name: 1 }, { unique: true });
  } catch (err) {
    nameIndexEnsured = false;
    logger.warn({ err }, 'DFE: failed to ensure unique team-name index');
  }
}

/**
 * Find an existing team by name, or create a new one.
 * When a new team is created, setupTeamDefaults() is called to provision
 * default ClickHouse connections and sources.
 *
 * Race-safe: first login fires several requests at once, so a plain
 * find-then-create raced two teams of the same name into existence. The unique
 * `name` index makes a concurrent create collide; we treat that 11000 as
 * "someone else won" and return the winner, so all requests land on ONE team.
 */
export async function findOrCreateTeamByName(name: string) {
  await ensureUniqueNameIndex();

  const existing = await Team.findOne({ name });
  if (existing) {
    return { team: existing, created: false };
  }

  let team;
  try {
    team = new Team({ name });
    await team.save();
  } catch (err) {
    if (isDuplicateKey(err)) {
      const winner = await Team.findOne({ name });
      if (winner) {
        return { team: winner, created: false };
      }
    }
    throw err;
  }

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
