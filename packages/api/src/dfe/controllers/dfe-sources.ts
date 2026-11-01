// DFE sources on EVERY team.
//
// The engine's service principal resolves to the team named by
// DFE_AUTH_DEFAULT_TEAM, which no human is in and which holds no connection, so
// a source it wrote through the team-scoped /sources surface was invisible to
// everyone. These helpers write the same source to every team instead, each over
// that team's own connection - the rows stay fenced by the ClickHouse row
// policies behind that connection, which is where DFE's tenant isolation lives.
//
// Ownership: the fork writes only sources the manifest claims, and the manifest
// never claims a name ensureOrgConnection seeds. A name a team already holds
// that the manifest does not claim is left alone too.
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
import { retryUpsertRace } from '@/dfe/models/duplicate-key';
import { indexOnce } from '@/dfe/models/index-once';
import { Source } from '@/models/source';
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

/**
 * The sources ensureOrgConnection seeds, on every team or on the platform team.
 * Reserved whether or not a team holds one yet: before the first login no team
 * does, and a manifest entry of one of these names would replace the seeded
 * source on every team seeded after it.
 */
export const SEEDED_SOURCE_NAMES: ReadonlySet<string> = new Set([
  'main',
  'hunts',
  'otel_logs',
  'otel_traces',
  'otel_metrics',
  'clickhouse_system',
]);

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

// A team holds at most one source of a name. The index name is ours, so it
// never collides with one upstream adds, and the upstream model stays pristine.
// Started at API start so a team's first seed does not wait on the build.
export const ensureOneSourceNamePerTeam = indexOnce(
  () =>
    Source.collection.createIndex(
      { team: 1, name: 1 },
      { unique: true, name: 'dfe_one_source_name_per_team' },
    ),
  'one source name per team',
);

async function connectionIdFor(teamId: string): Promise<string | undefined> {
  const connections = await getConnectionsByTeam(teamId);
  const first = connections[0];
  return first ? String(first._id) : undefined;
}

/**
 * Is this name the fork's to write? False for a seeded name, and when a team
 * already holds a source of that name that the engine never pushed - replacing
 * either would silently retarget the landing view of every team.
 */
export async function isOwnedName(name: string): Promise<boolean> {
  if (SEEDED_SOURCE_NAMES.has(name)) {
    return false;
  }
  if (await DfeSource.exists({ name: { $eq: name } })) {
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

  await ensureOneSourceNamePerTeam();
  const body = specForTeam(name, spec, connection);
  // A racing write that creates the source first fails this create on the
  // index, and the retry finds that source and replaces it.
  return retryUpsertRace(async () => {
    const existing = await sourceNamed(teamId, name);
    if (existing) {
      const updated = await updateSource(teamId, String(existing._id), body);
      return updated ? String(existing._id) : undefined;
    }
    const created = await createSource(teamId, body);
    return created ? String(created._id) : undefined;
  });
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
  await retryUpsertRace(async () =>
    DfeSource.findOneAndUpdate(
      { name: { $eq: name } },
      { $set: { name, spec }, $unset: { deleting: '' } },
      { upsert: true, new: true },
    ),
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

/**
 * Drop the source from every team that holds it, then from the manifest.
 *
 * The entry is marked `deleting` first, so a team seeded meanwhile is not given
 * the source, and is kept until every team's copy is gone. That keeps the name
 * the engine's while a team still holds it, so a retry removes the rest.
 */
export async function removeEverywhere(
  name: string,
): Promise<{ removed: string[]; failed: string[] }> {
  await DfeSource.updateOne(
    { name: { $eq: name } },
    { $set: { deleting: true } },
  );

  const removed: string[] = [];
  const failed: string[] = [];
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
      failed.push(team.name);
    }
  }
  if (failed.length === 0) {
    await DfeSource.deleteOne({ name: { $eq: name } });
  }
  return { removed, failed };
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
    if (SEEDED_SOURCE_NAMES.has(entry.name) || entry.deleting) {
      continue;
    }
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
