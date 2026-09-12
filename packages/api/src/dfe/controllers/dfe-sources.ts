// DFE sources on EVERY team.
//
// The engine's service principal resolves to the team named by
// DFE_AUTH_DEFAULT_TEAM, which no human is in and which holds no connection, so
// a source it wrote through the team-scoped /sources surface was invisible to
// everyone. These helpers write the same source to every team instead, each over
// that team's own connection - the rows stay fenced by the ClickHouse row
// policies behind that connection, which is where DFE's tenant isolation lives.
//
// Ownership: the fork writes only sources the manifest claims. A name a team
// already holds that the manifest does not claim was seeded by
// ensureOrgConnection, and is left alone.
//
// This is a NEW file - it does not modify any upstream HyperDX files.
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * The source controllers take the discriminated ISourceInput union; the engine's
 * body is validated at the route and asserted into it here, once.
 */

import { getConnectionsByTeam } from '@/controllers/connection';
import {
  createSource,
  deleteSource,
  getSources,
  updateSource,
} from '@/controllers/sources';
import DfeSource from '@/dfe/models/dfe-source';
import Team from '@/models/team';
import logger from '@/utils/logger';

// The source body the engine pushes: everything the fork's SourceSchemaNoId
// takes except `connection`, which is resolved per team.
export type DfeSourceSpec = Record<string, unknown>;

export type TeamSources = {
  team: string;
  teamName: string;
  sources: { id: string; name: string; from: unknown }[];
};

type SourceWrite = Parameters<typeof createSource>[1];

function specForTeam(
  name: string,
  spec: DfeSourceSpec,
  connectionId: string,
): SourceWrite {
  return { ...spec, name, connection: connectionId } as SourceWrite;
}

async function teamIds(): Promise<{ id: string; name: string }[]> {
  const teams = await Team.find({});
  return teams.map(team => ({ id: String(team._id), name: team.name }));
}

async function sourceNamed(teamId: string, name: string) {
  const sources = await getSources(teamId);
  return sources.find(source => source.name === name);
}

async function connectionIdFor(teamId: string): Promise<string | undefined> {
  const connections = await getConnectionsByTeam(teamId);
  const first = connections[0];
  return first ? String(first._id) : undefined;
}

/**
 * Is this name the fork's to write? False when a team already holds a source of
 * that name that the engine never pushed - that is one of the seeded sources
 * (`main`, `hunts`, the otel set), and replacing it would silently retarget the
 * landing view of every team.
 */
export async function isOwnedName(name: string): Promise<boolean> {
  if (await DfeSource.exists({ name })) {
    return true;
  }
  for (const team of await teamIds()) {
    if (await sourceNamed(team.id, name)) {
      return false;
    }
  }
  return true;
}

/**
 * Create or replace one DFE source on one team, over that team's connection.
 *
 * Returns the source id, or undefined when the team has no connection to hang it
 * on - the engine's own service team is exactly that case.
 */
export async function upsertOnTeam(
  teamId: string,
  name: string,
  spec: DfeSourceSpec,
  connectionId?: string,
): Promise<string | undefined> {
  const connection = connectionId ?? (await connectionIdFor(teamId));
  if (!connection) {
    return undefined;
  }

  const existing = await sourceNamed(teamId, name);
  const body = specForTeam(name, spec, connection);
  if (existing) {
    const updated = await updateSource(teamId, String(existing._id), body);
    return updated ? String(existing._id) : undefined;
  }
  const created = await createSource(teamId, body);
  return created ? String(created._id) : undefined;
}

/**
 * Register the source and put it on every team that has a connection.
 *
 * The manifest is written first, so a team created part-way through the loop is
 * seeded with it by ensureOrgConnection rather than missing it.
 */
export async function upsertEverywhere(
  name: string,
  spec: DfeSourceSpec,
): Promise<{ written: string[]; skipped: string[] }> {
  await DfeSource.findOneAndUpdate(
    { name },
    { name, spec },
    { upsert: true, new: true },
  );

  const written: string[] = [];
  const skipped: string[] = [];
  for (const team of await teamIds()) {
    try {
      const sourceId = await upsertOnTeam(team.id, name, spec);
      (sourceId ? written : skipped).push(team.name);
    } catch (err) {
      logger.warn(
        { err, team: team.name, source: name },
        'DFE: source not written to team',
      );
      skipped.push(team.name);
    }
  }
  return { written, skipped };
}

/** Drop the source from the manifest and from every team that holds it. */
export async function removeEverywhere(
  name: string,
): Promise<{ removed: string[] }> {
  await DfeSource.deleteOne({ name });

  const removed: string[] = [];
  for (const team of await teamIds()) {
    try {
      const existing = await sourceNamed(team.id, name);
      if (existing) {
        await deleteSource(team.id, String(existing._id));
        removed.push(team.name);
      }
    } catch (err) {
      logger.warn(
        { err, team: team.name, source: name },
        'DFE: source not removed from team',
      );
    }
  }
  return { removed };
}

/** Every team, with the registered DFE sources it currently holds. */
export async function listByTeam(): Promise<TeamSources[]> {
  const manifest = await DfeSource.find({});
  const registered = new Set(manifest.map(entry => entry.name));

  const listing: TeamSources[] = [];
  for (const team of await teamIds()) {
    const sources = await getSources(team.id);
    listing.push({
      team: team.id,
      teamName: team.name,
      sources: sources
        .filter(source => registered.has(source.name))
        .map(source => ({
          id: String(source._id),
          name: source.name,
          from: source.from,
        })),
    });
  }
  return listing;
}

/**
 * Seed every registered DFE source onto a team created after the engine pushed
 * them. Called from the team-seed path with the connection it just created.
 *
 * Non-fatal per source: one bad manifest entry must not cost the team the rest.
 */
export async function seedDfeSources(
  teamId: string,
  connectionId: string,
): Promise<string[]> {
  const seeded: string[] = [];
  for (const entry of await DfeSource.find({})) {
    try {
      const sourceId = await upsertOnTeam(
        teamId,
        entry.name,
        entry.spec,
        connectionId,
      );
      if (sourceId) {
        seeded.push(entry.name);
      }
    } catch (err) {
      logger.warn(
        { err, teamId, source: entry.name },
        'DFE: registered source not seeded onto the new team',
      );
    }
  }
  return seeded;
}
