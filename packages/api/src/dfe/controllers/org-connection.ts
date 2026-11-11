// DFE per-org ClickHouse connection provisioning.
//
// The engine is the SOLE source of a team's ClickHouse connection. A team is
// named after the ClickHouse user the engine hands its members, and holds one
// connection as exactly that user: the fork asks the engine for the CALLER's own
// connection and seeds it only when its username is the team's name, so a team
// never holds a credential its members were not each handed. This is the fork
// half of the per-org connection seam (dfe-engine#124) - it replaces the global
// DEFAULT_CONNECTIONS blob that handed every team every org's connection.
//
// This is a NEW file - it does not modify any upstream HyperDX files.
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Bridging the engine's JSON response and the loosely-typed connection/source
 * controllers means asserting narrower types than their broad exports.
 */

import type { Response } from 'express';
import { z } from 'zod';

import {
  createConnection,
  getConnectionById,
  getConnectionsByTeam,
  updateConnection,
} from '@/controllers/connection';
import { createSource, getSources, updateSource } from '@/controllers/sources';
import * as dfeConfig from '@/dfe/config';
import { seedDfeSources } from '@/dfe/controllers/dfe-sources';
import { isDuplicateKey } from '@/dfe/models/duplicate-key';
import {
  awaitTeamSeed,
  claimTeamSeed,
  settleTeamSeed,
} from '@/dfe/models/team-seed';
import Connection from '@/models/connection';
import { syncDashboards } from '@/tasks/provisionDashboards';
import logger from '@/utils/logger';

/**
 * The engine's connection material.
 *
 * Parsed rather than asserted: this is a response from another service, and
 * `password` is written straight onto a ClickHouse connection. A hand-rolled
 * guard checked the other three fields and missed that one, which would have
 * stored `undefined` as the password.
 */
const OrgConnectionSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  username: z.string().min(1),
  password: z.string(),
  // The engine decides which seed set a team gets and where its tables live,
  // so a deployment's own data database and catalogue reach every source.
  platform: z.boolean(),
  database: z.string().min(1),
  tables: z.object({
    'data.main': z.string().min(1),
    'data.detection': z.string().min(1),
    'data.otel_logs': z.string().min(1),
    'data.otel_traces': z.string().min(1),
    'data.otel_metrics_gauge': z.string().min(1),
    'data.otel_metrics_sum': z.string().min(1),
    'data.otel_metrics_histogram': z.string().min(1),
    'data.otel_metrics_exponential_histogram': z.string().min(1),
    'data.otel_metrics_summary': z.string().min(1),
  }),
});

type OrgConnection = z.infer<typeof OrgConnectionSchema>;

// The engine API shares an origin with its JWKS endpoint, so we derive the base
// URL from DFE_ENGINE_JWKS_URL rather than carrying a second env var.
// Exported as the single definition of the engine origin so DFE routers reuse it
// rather than re-deriving it from the JWKS URL.
export function engineOrigin(): string | undefined {
  const jwks = dfeConfig.DFE_ENGINE_JWKS_URL;
  if (!jwks) {
    return undefined;
  }
  try {
    return new URL(jwks).origin;
  } catch {
    return undefined;
  }
}

// `refused` is the engine answering 401/403; `unavailable` is any answer it could not give.
async function fetchOrgConnection(
  token: string,
): Promise<OrgConnection | 'refused' | 'unavailable'> {
  const origin = engineOrigin();
  if (!origin) {
    return 'unavailable';
  }
  try {
    const resp = await fetch(`${origin}/api/v1/hyperdx/connection`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(dfeConfig.DFE_ENGINE_TIMEOUT_MS),
    });
    if (resp.status === 401 || resp.status === 403) {
      logger.warn(
        { status: resp.status },
        'DFE: engine connection endpoint refused',
      );
      return 'refused';
    }
    if (!resp.ok) {
      logger.warn(
        { status: resp.status },
        'DFE: engine connection endpoint answered with an error',
      );
      return 'unavailable';
    }
    const parsed = OrgConnectionSchema.safeParse(await resp.json());
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues.map(issue => issue.path.join('.')) },
        'DFE: engine connection material failed validation',
      );
      return 'unavailable';
    }
    return parsed.data;
  } catch (err) {
    logger.warn({ err }, 'DFE: engine connection endpoint unreachable');
    return 'unavailable';
  }
}

// The index name is ours, so it never collides with one upstream adds on `team`.
const ONE_CONNECTION_PER_TEAM = 'dfe_one_connection_per_team';

let teamIndexEnsured = false;

/**
 * Ensure a team can hold at most one connection, so a seed racing on another
 * replica collides instead of adding a second. Ensured from the dfe layer with
 * an idempotent createIndex, so the upstream Connection model stays pristine.
 *
 * Only called in oidc-proxy mode: header-dev and upstream seed several
 * DEFAULT_CONNECTIONS onto one team.
 *
 * @returns whether the index is in place.
 */
export async function ensureOneConnectionPerTeam(): Promise<boolean> {
  if (teamIndexEnsured) {
    return true;
  }
  try {
    await Connection.collection.createIndex(
      { team: 1 },
      { unique: true, name: ONE_CONNECTION_PER_TEAM },
    );
    teamIndexEnsured = true;
  } catch (err) {
    logger.warn({ err }, 'DFE: failed to ensure one connection per team');
  }
  return teamIndexEnsured;
}

// Every table name and the data database come from the engine's material, so a
// deployment that sets DFE_ENGINE_CLICKHOUSE_DATA_DATABASE seeds sources there.
// The platform flag is the engine's call too: a tenant gets ONLY `main` and
// `hunts`, because otel is unfenced operator telemetry.

// One generic log source over the landing table, the per-team equivalent of the
// DEFAULT_SOURCES template. EVERY team gets this, platform and tenant alike.
function defaultSource(connectionId: string, m: OrgConnection) {
  return {
    name: 'main',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: m.database, tableName: m.tables['data.main'] },
    timestampValueExpression: '_timestamp',
    displayedTimestampValueExpression: '_timestamp',
    // DFE data lands in the structured `_json` column; `_raw` is the exception
    // (raw payload, only when captured) and may be NULL. Surface `_json` as the
    // body, the implicit search column and the default view -- never `_raw`.
    implicitColumnExpression: '_json',
    bodyExpression: '_json',
    defaultTableSelectExpression: '_timestamp,_json',
  };
}

// The hunt-detection source over the detection table in the data database.
// Seeded on EVERY team, and org-fenced the same way: the tenant row policy
// scopes a tenant to its own _org_id while the platform reader sees every org.
function huntsSource(connectionId: string, m: OrgConnection) {
  return {
    name: 'hunts',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: m.database, tableName: m.tables['data.detection'] },
    timestampValueExpression: '_timestamp',
    displayedTimestampValueExpression: '_timestamp',
    implicitColumnExpression: 'rule_name',
    bodyExpression: '_json',
    // Detection payload only -- drop the _org_id/_source header plumbing, keep
    // the analyst-facing match columns plus the structured `_json`.
    defaultTableSelectExpression:
      '_timestamp,severity,hunt_name,rule_name,source_table,matched_uuid,rule_id,_json',
  };
}

// PLATFORM-ONLY otel sources. The three below (log/trace/metric) are seeded ONLY
// on the platform/admin team - operator telemetry the standard OTel collector
// schema writes into the data database. Expressions match the columns upstream infers
// for an OTel schema (see app/src/source.ts getSourceConfig inference, and the
// hdx-eval setup builders) so HyperDX's search/trace/metric UIs light up the
// same as a native OTel deployment.
//
// Column expressions are the standard OTel ClickHouse exporter columns:
// Timestamp/Body/ServiceName/SeverityText for logs; Duration/SpanId/TraceId for
// traces; TimeUnix/ServiceName plus the five metricTables for metrics.
function otelLogsSource(connectionId: string, m: OrgConnection) {
  return {
    name: 'otel_logs',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: m.database, tableName: m.tables['data.otel_logs'] },
    timestampValueExpression: 'Timestamp',
    displayedTimestampValueExpression: 'Timestamp',
    defaultTableSelectExpression:
      'Timestamp, ServiceName as service, SeverityText as level, Body',
    serviceNameExpression: 'ServiceName',
    severityTextExpression: 'SeverityText',
    bodyExpression: 'Body',
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    implicitColumnExpression: 'Body',
    eventAttributesExpression: 'LogAttributes',
    resourceAttributesExpression: 'ResourceAttributes',
  };
}

function otelTracesSource(connectionId: string, m: OrgConnection) {
  return {
    name: 'otel_traces',
    kind: 'trace',
    connection: connectionId,
    from: { databaseName: m.database, tableName: m.tables['data.otel_traces'] },
    timestampValueExpression: 'Timestamp',
    displayedTimestampValueExpression: 'Timestamp',
    defaultTableSelectExpression:
      'Timestamp, ServiceName as service, StatusCode as level, round(Duration / 1e6) as duration, SpanName',
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    statusCodeExpression: 'StatusCode',
    statusMessageExpression: 'StatusMessage',
    serviceNameExpression: 'ServiceName',
    resourceAttributesExpression: 'ResourceAttributes',
    eventAttributesExpression: 'SpanAttributes',
    implicitColumnExpression: 'SpanName',
  };
}

// The Metric kind bundles all five OTel metric tables in one source: from carries
// the database and the metricTables map carries the per-kind BARE table names
// (renderChartConfig overrides from.tableName per kind), so from.databaseName
// resolves each to <database>.<table>. Keys are the MetricsDataType enum string
// values - note 'exponential histogram' has a space.
function otelMetricsSource(connectionId: string, m: OrgConnection) {
  return {
    name: 'otel_metrics',
    kind: 'metric',
    connection: connectionId,
    from: { databaseName: m.database, tableName: '' },
    timestampValueExpression: 'TimeUnix',
    serviceNameExpression: 'ServiceName',
    resourceAttributesExpression: 'ResourceAttributes',
    metricTables: {
      gauge: m.tables['data.otel_metrics_gauge'],
      sum: m.tables['data.otel_metrics_sum'],
      histogram: m.tables['data.otel_metrics_histogram'],
      'exponential histogram':
        m.tables['data.otel_metrics_exponential_histogram'],
      summary: m.tables['data.otel_metrics_summary'],
    },
  };
}

// PLATFORM-ONLY. ClickHouse's own `system` database: server log lines to search,
// and the connection the pre-canned ClickHouse dashboards run their raw SQL on.
// `system.text_log` is the searchable table; the dashboards name their own
// system tables in full, so the `from` here only decides what /search shows.
//
// Reading it needs SELECT on the system tables, which the engine grants to the
// platform reader alone - a tenant's dfe_org_<org> user cannot read them at all,
// so this source is fenced twice over.
function clickhouseSystemSource(connectionId: string) {
  return {
    name: 'clickhouse_system',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: 'system', tableName: 'text_log' },
    timestampValueExpression: 'event_time',
    displayedTimestampValueExpression: 'event_time',
    defaultTableSelectExpression:
      'event_time, level, logger_name, message, query_id',
    severityTextExpression: 'level',
    bodyExpression: 'message',
    implicitColumnExpression: 'message',
    serviceNameExpression: 'logger_name',
  };
}

/**
 * The seed sources for a team holding `connectionId`, as the engine described it.
 *
 * EVERY team gets `main` and `hunts` (both org-fenced by their tenant row
 * policies). The platform/admin team ALSO gets the otel sources and ClickHouse's
 * own system database. Tenant teams never do.
 *
 * This set is the deployment's fixed floor - the tables the engine bootstraps
 * whether or not an operator ever defines a source. Everything an operator DOES
 * define arrives through PUT /dfe/sources/:name and is seeded from the manifest,
 * so it is not added here. Its names are dfe-sources' SEEDED_SOURCE_NAMES.
 */
function seedSourceSpecs(
  connectionId: string,
  material: OrgConnection,
): Record<string, unknown>[] {
  const specs: Record<string, unknown>[] = [
    defaultSource(connectionId, material),
    huntsSource(connectionId, material),
  ];
  if (material.platform) {
    specs.push(
      otelLogsSource(connectionId, material),
      otelTracesSource(connectionId, material),
      otelMetricsSource(connectionId, material),
      clickhouseSystemSource(connectionId),
    );
  }
  return specs;
}

/**
 * Put every seed source and every registered DFE source on the team, over
 * `connectionId`. A seed source the team is missing is created, and one left on
 * another connection - a connection deleted and seeded again - is repointed.
 * Throws when any write fails, so the caller does not record the team as done.
 *
 * @returns whether a seed source was written.
 */
async function reconcileTeamSources(
  teamId: string,
  connectionId: string,
  material: OrgConnection,
): Promise<boolean> {
  const held = new Map(
    (await getSources(teamId)).map(source => [source.name, source]),
  );
  let wrote = false;
  for (const spec of seedSourceSpecs(connectionId, material)) {
    const existing = held.get(spec.name as string);
    if (existing && String(existing.connection) === connectionId) {
      continue;
    }
    if (existing) {
      await updateSource(
        teamId,
        String(existing._id),
        spec as Parameters<typeof updateSource>[2],
      );
    } else {
      try {
        await createSource(teamId, spec as Parameters<typeof createSource>[1]);
      } catch (err) {
        // Another replica reconciling the same team created it first.
        if (!isDuplicateKey(err)) {
          throw err;
        }
      }
    }
    wrote = true;
  }

  // Sources the engine registered before this team existed, or before its
  // connection did. The engine's PUT /dfe/sources/:name only reaches the teams
  // that held a connection when it ran.
  const { failed } = await seedDfeSources(teamId, connectionId);
  if (failed.length > 0) {
    throw new Error(`registered sources not seeded: ${failed.join(', ')}`);
  }
  return wrote;
}

/**
 * What ensureOrgConnection found or did.
 *
 * - `present`: the team already holds its own connection, and nothing else.
 * - `seeded`: this call created it.
 * - `unavailable`: the engine or the store could not answer, or another
 *   request's seed did not settle in time; a later request retries.
 * - `refused`: the engine refused this caller a connection.
 * - `mismatch`: the team holds, or the engine offered, a ClickHouse user other
 *   than the one the team is named after.
 */
export type SeedOutcome =
  | 'present'
  | 'seeded'
  | 'unavailable'
  | 'refused'
  | 'mismatch';

// How long a seeding attempt holds its claim, and so how soon a team whose
// attempt failed is tried again. Covers the engine timeout plus the writes.
const SEED_LEASE_MS = 30_000;

// When this process next claims a team its last attempt could not seed.
const nextSeedCheck = new Map<string, number>();

// Teams this process has seen with no seed in flight, with the connection they held then.
// A re-seed on another replica writes a new connection, so a different id is not settled.
const seedSettled = new Map<string, string>();

// Teams whose sources this process has reconciled, with the connection they now use.
const sourcesReconciled = new Map<string, string>();

/** Settle the team's claim, once more if the first write fails, so waiters are not left to the lease. */
async function settleSeedClaim(teamId: string): Promise<void> {
  try {
    await settleTeamSeed(teamId);
  } catch (err) {
    logger.warn(
      { err, teamId },
      'DFE: could not settle the team seed, retrying',
    );
    await settleTeamSeed(teamId);
  }
}

/**
 * Wait for another request's seed of the team to settle, so this request does
 * not read the team half-seeded. False when it did not settle within the lease.
 */
async function waitForTeamSeed(
  teamId: string,
  connectionId?: string,
): Promise<boolean> {
  if (connectionId != null && seedSettled.get(teamId) === connectionId) {
    return true;
  }
  let wait;
  try {
    wait = await awaitTeamSeed(teamId, SEED_LEASE_MS);
  } catch (err) {
    logger.warn({ err, teamId }, 'DFE: could not read the team seed claim');
    return false;
  }
  if (wait === 'timeout') {
    logger.warn(
      { teamId },
      'DFE: another request seeding the team did not finish; going on without it',
    );
    return false;
  }
  if (connectionId != null) {
    seedSettled.set(teamId, connectionId);
  }
  return true;
}

// ClickHouse's HTTP interface names a refused credential with this code in this header.
const CLICKHOUSE_EXCEPTION_CODE = 'x-clickhouse-exception-code';
const AUTHENTICATION_FAILED = '516';

// A team ClickHouse keeps refusing asks the engine at most this often.
const RECHECK_INTERVAL_MS = 30_000;

// Teams whose held connection ClickHouse refused since this process last re-checked it.
const refusedTeams = new Set<string>();

// When this process last asked the engine for each refused team's material.
const lastRecheck = new Map<string, number>();

/**
 * Mark the team's held connection for a re-check against the engine when
 * ClickHouse refuses its credential on this response. The query proxy copies
 * ClickHouse's response headers onto `res`.
 */
export function recheckOnAuthFailure(res: Response, teamId: string): void {
  res.once('finish', () => {
    if (
      String(res.getHeader(CLICKHOUSE_EXCEPTION_CODE)) === AUTHENTICATION_FAILED
    ) {
      refusedTeams.add(teamId);
    }
  });
}

/**
 * Ensure the team named `identity` holds ONLY its own connection, as the
 * ClickHouse user `identity`, plus its seed sources: `main` and `hunts` for every
 * team, and the otel sources as well for the platform/admin team (see the source
 * builders above for the RBAC split).
 *
 * Reads the team's connections on every request. A team holding a connection as
 * anyone else answers `mismatch` and is never reused. A held connection ClickHouse
 * has refused is re-checked against the engine, and its sources are reconciled
 * by name and connection once per process. A team holding none is
 * seeded, whatever an earlier attempt did, so a first seed that failed or a
 * connection since deleted is restored. A seed counts as `seeded` only once
 * every source is in place. One claim per team (dfe/models/team-seed)
 * keeps that to a single attempt at a time across replicas, and a failed attempt
 * is retried once the claim lapses. A request that meets an attempt in flight
 * waits for it to settle, bounded by the lease, so it never answers for a team
 * that has its connection and not yet its sources. The engine's material is
 * seeded only when its username is `identity`. Engine and store faults are
 * logged and answered `unavailable`, which does not block a login.
 */
export async function ensureOrgConnection(
  token: string,
  teamId: string,
  identity: string,
): Promise<SeedOutcome> {
  let held: { _id?: unknown; username?: string }[];
  try {
    held = await getConnectionsByTeam(teamId);
  } catch (err) {
    logger.warn({ err, teamId }, 'DFE: could not read the team connection');
    return 'unavailable';
  }
  if (held.length > 0) {
    const foreign = held
      .map(connection => connection.username)
      .filter(username => username !== identity);
    if (foreign.length === 0) {
      const connectionId = String(held[0]._id);
      await waitForTeamSeed(teamId, connectionId);
      await reconcileHeldConnection(token, teamId, identity, connectionId);
      await recheckRefusedConnection(token, teamId, identity, connectionId);
      return 'present';
    }
    logger.error(
      { teamId, team: identity, foreign },
      'DFE: team holds a connection that is not its own ClickHouse identity',
    );
    return 'mismatch';
  }

  seedSettled.delete(teamId);
  if ((nextSeedCheck.get(teamId) ?? 0) > Date.now()) {
    return 'unavailable';
  }
  let outcome: SeedOutcome = 'unavailable';
  try {
    if ((await claimTeamSeed(teamId, SEED_LEASE_MS)) === 'claimed') {
      try {
        outcome = await seedTeam(token, teamId, identity);
      } finally {
        await settleSeedClaim(teamId);
      }
    } else if (await waitForTeamSeed(teamId)) {
      const seeded = await getConnectionsByTeam(teamId);
      const own =
        seeded.length > 0 && seeded.every(conn => conn.username === identity);
      outcome = own ? 'present' : 'unavailable';
    }
  } catch (err) {
    logger.warn({ err, teamId }, 'DFE: team seeding failed (non-fatal)');
  }
  if (outcome === 'seeded' || outcome === 'present') {
    nextSeedCheck.delete(teamId);
  } else {
    nextSeedCheck.set(teamId, Date.now() + SEED_LEASE_MS);
  }
  return outcome;
}

/**
 * Reconcile a held connection's sources once per process, so a seed that wrote
 * the connection and not every source is finished by a later request. The
 * engine's material names the tables, so it is read once per team per process.
 * A pass that fails, or that the engine cannot answer, is tried again once the
 * seed lease lapses. Never fails the request.
 */
async function reconcileHeldConnection(
  token: string,
  teamId: string,
  identity: string,
  connectionId: string,
): Promise<void> {
  if (
    sourcesReconciled.get(teamId) === connectionId ||
    (nextSeedCheck.get(teamId) ?? 0) > Date.now()
  ) {
    return;
  }
  try {
    const material = await fetchOrgConnection(token);
    if (typeof material === 'string' || material.username !== identity) {
      logger.warn(
        { teamId, team: identity },
        'DFE: no engine material for the team; sources not reconciled',
      );
      nextSeedCheck.set(teamId, Date.now() + SEED_LEASE_MS);
      return;
    }
    await reconcileTeamSources(teamId, connectionId, material);
    sourcesReconciled.set(teamId, connectionId);
    nextSeedCheck.delete(teamId);
  } catch (err) {
    logger.warn(
      { err, teamId },
      'DFE: team sources not reconciled, retried after the lease',
    );
    nextSeedCheck.set(teamId, Date.now() + SEED_LEASE_MS);
  }
}

/** Forget every team this process is waiting to seed again or re-check. */
export function clearTeamSeedCache(): void {
  nextSeedCheck.clear();
  seedSettled.clear();
  sourcesReconciled.clear();
  refusedTeams.clear();
  lastRecheck.clear();
}

/**
 * Bring a refused team's held connection up to the engine's current material.
 * The engine replaces a reader's password when the deployment hands it a new
 * one, and the stored copy does not follow on its own. Asks at most once per
 * RECHECK_INTERVAL_MS per team, so a refusal the engine cannot fix reaches the
 * caller as ClickHouse's own error rather than looping. Never fails the request.
 */
async function recheckRefusedConnection(
  token: string,
  teamId: string,
  identity: string,
  connectionId: string,
): Promise<void> {
  const now = Date.now();
  const last = lastRecheck.get(teamId);
  if (
    !refusedTeams.has(teamId) ||
    (last !== undefined && now - last < RECHECK_INTERVAL_MS)
  ) {
    return;
  }
  refusedTeams.delete(teamId);
  lastRecheck.set(teamId, now);
  try {
    const material = await fetchOrgConnection(token);
    if (material === 'refused' || material === 'unavailable') {
      logger.warn(
        { teamId, team: identity, outcome: material },
        'DFE: could not re-check a team connection ClickHouse refused',
      );
      return;
    }
    if (material.username !== identity) {
      logger.warn(
        { teamId, team: identity, username: material.username },
        'DFE: engine connection is not the team identity; not updated',
      );
      return;
    }
    const stored = await getConnectionById(teamId, connectionId, true);
    if (stored == null) {
      return;
    }
    if (
      stored.host === material.host &&
      stored.password === material.password
    ) {
      logger.warn(
        { teamId, team: identity },
        'DFE: ClickHouse refused a team connection that matches the engine',
      );
      return;
    }
    await updateConnection(teamId, connectionId, {
      host: material.host,
      password: material.password,
    } as Parameters<typeof updateConnection>[2]);
    logger.info(
      { teamId, team: identity },
      'DFE: team connection updated to the engine material',
    );
  } catch (err) {
    logger.warn(
      { err, teamId },
      'DFE: re-checking a refused team connection failed',
    );
  }
}

async function seedTeam(
  token: string,
  teamId: string,
  identity: string,
): Promise<SeedOutcome> {
  let outcome: SeedOutcome = 'unavailable';
  try {
    const material = await fetchOrgConnection(token);
    if (material === 'refused' || material === 'unavailable') {
      return material;
    }
    if (material.username !== identity) {
      logger.warn(
        { teamId, team: identity, username: material.username },
        'DFE: engine connection is not the team identity; not seeded',
      );
      return 'mismatch';
    }

    await ensureOneConnectionPerTeam();
    let conn;
    try {
      conn = await createConnection(teamId, {
        name: material.name,
        host: material.host,
        username: material.username,
        password: material.password,
      } as Parameters<typeof createConnection>[1]);
    } catch (err) {
      if (isDuplicateKey(err)) {
        // Another replica seeded this team first, through the same identity check.
        return 'present';
      }
      throw err;
    }

    // Seeded only once every source is in place. Until then a later request
    // reconciles the held connection.
    const connectionId = String(conn._id);
    const wrote = await reconcileTeamSources(teamId, connectionId, material);
    sourcesReconciled.set(teamId, connectionId);
    outcome = 'seeded';

    // The cron would otherwise leave the new team's first page load empty.
    const dashboardDir = process.env.DASHBOARD_PROVISIONER_DIR;
    if (wrote && dashboardDir) {
      await syncDashboards(
        teamId,
        dashboardDir,
        process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS === 'true',
      );
    }
  } catch (err) {
    logger.warn(
      { err, teamId },
      'DFE: org connection provisioning failed (non-fatal)',
    );
  }
  return outcome;
}
