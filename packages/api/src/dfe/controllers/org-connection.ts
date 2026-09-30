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

import { z } from 'zod';

import {
  createConnection,
  getConnectionsByTeam,
} from '@/controllers/connection';
import { createSource, getSources } from '@/controllers/sources';
import * as dfeConfig from '@/dfe/config';
import { seedDfeSources } from '@/dfe/controllers/dfe-sources';
import { isDuplicateKey } from '@/dfe/models/duplicate-key';
import { claimTeamSeed } from '@/dfe/models/team-seed';
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
});

type OrgConnection = z.infer<typeof OrgConnectionSchema>;

const ENGINE_TIMEOUT_MS = 5000;

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
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
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

// The engine returns this ClickHouse username for the PLATFORM/admin team - the
// unrestricted reader that sees every org's rows. Any other username (the
// per-org dfe_org_<org> readers) is a tenant, row-policy fenced to one org.
const PLATFORM_READER_USERNAME = 'dfe_query_reader';

// The engine's data database (DFE_CLICKHOUSE_DATA_DATABASE, default `dfe`).
// Everything the engine writes lands in it - `main` and `detection` alike -
// so both seeded DFE sources resolve from this one constant.
const DATA_DATABASE = 'dfe';

// The OTel database. Renamed from `default` to `dfe`, so every otel_* table is
// dfe.otel_*. Kept as one constant so the rename lands in a single place.
const OTEL_DATABASE = 'dfe';

// A team is the platform/admin team iff its connection reads as the unrestricted
// platform reader. Anything else (including the dfe_org_<org> tenant readers, or
// an unrecognised username) is treated as a tenant and gets ONLY `main` and `hunts` - otel
// is unfenced operator telemetry and must never reach an org_viewer.
function isPlatformReader(username: string): boolean {
  return username === PLATFORM_READER_USERNAME;
}

// One generic log source over dfe.main, the per-team equivalent of the
// DEFAULT_SOURCES template. EVERY team gets this, platform and tenant alike.
// Named for the table the engine bootstraps from `clickhouse.landing_table`.
function defaultSource(connectionId: string) {
  return {
    name: 'main',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: DATA_DATABASE, tableName: 'main' },
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

// The hunt-detection source over `detection` in the data database - the engine
// builds that table alongside `main`, not in a hunts database of its own.
// Seeded on EVERY team, and org-fenced the same way: the tenant row policy
// scopes a tenant to its own _org_id while the platform reader sees every org.
// Interim hard-coding per the source-manifest TODO below.
function huntsSource(connectionId: string) {
  return {
    name: 'hunts',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: DATA_DATABASE, tableName: 'detection' },
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
// schema writes into dfe.otel_*. Expressions match the columns upstream infers
// for an OTel schema (see app/src/source.ts getSourceConfig inference, and the
// hdx-eval setup builders) so HyperDX's search/trace/metric UIs light up the
// same as a native OTel deployment.
//
// Column expressions are the standard OTel ClickHouse exporter columns:
// Timestamp/Body/ServiceName/SeverityText for logs; Duration/SpanId/TraceId for
// traces; TimeUnix/ServiceName plus the five metricTables for metrics.
function otelLogsSource(connectionId: string) {
  return {
    name: 'otel_logs',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: OTEL_DATABASE, tableName: 'otel_logs' },
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

function otelTracesSource(connectionId: string) {
  return {
    name: 'otel_traces',
    kind: 'trace',
    connection: connectionId,
    from: { databaseName: OTEL_DATABASE, tableName: 'otel_traces' },
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
// (renderChartConfig overrides from.tableName per kind), so from.databaseName=dfe
// resolves each to dfe.otel_metrics_*. Keys are the MetricsDataType enum string
// values - note 'exponential histogram' has a space.
function otelMetricsSource(connectionId: string) {
  return {
    name: 'otel_metrics',
    kind: 'metric',
    connection: connectionId,
    from: { databaseName: OTEL_DATABASE, tableName: '' },
    timestampValueExpression: 'TimeUnix',
    serviceNameExpression: 'ServiceName',
    resourceAttributesExpression: 'ResourceAttributes',
    metricTables: {
      gauge: 'otel_metrics_gauge',
      sum: 'otel_metrics_sum',
      histogram: 'otel_metrics_histogram',
      'exponential histogram': 'otel_metrics_exponential_histogram',
      summary: 'otel_metrics_summary',
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
 * What ensureOrgConnection found or did.
 *
 * - `present`: the team already holds its own connection, and nothing else.
 * - `seeded`: this call created it.
 * - `unavailable`: the engine or the store could not answer, or another request
 *   is seeding the team; a later request retries.
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

/**
 * Ensure the team named `identity` holds ONLY its own connection, as the
 * ClickHouse user `identity`, plus its seed sources: `main` and `hunts` for every
 * team, and the otel sources as well for the platform/admin team (see the source
 * builders above for the RBAC split).
 *
 * Reads the team's connections on every request. A team holding a connection as
 * anyone else answers `mismatch` and is never reused. A team holding none is
 * seeded, whatever an earlier attempt did, so a first seed that failed or a
 * connection since deleted is restored. One claim per team (dfe/models/team-seed)
 * keeps that to a single attempt at a time across replicas, and a failed attempt
 * is retried once the claim lapses. The engine's material is seeded only when its
 * username is `identity`. Engine and store faults are logged and answered
 * `unavailable`, which does not block a login.
 */
export async function ensureOrgConnection(
  token: string,
  teamId: string,
  identity: string,
): Promise<SeedOutcome> {
  let held: { username?: string }[];
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
      return 'present';
    }
    logger.error(
      { teamId, team: identity, foreign },
      'DFE: team holds a connection that is not its own ClickHouse identity',
    );
    return 'mismatch';
  }

  if ((nextSeedCheck.get(teamId) ?? 0) > Date.now()) {
    return 'unavailable';
  }
  let outcome: SeedOutcome = 'unavailable';
  try {
    if ((await claimTeamSeed(teamId, SEED_LEASE_MS)) === 'claimed') {
      outcome = await seedTeam(token, teamId, identity);
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

/** Forget every team this process is waiting to seed again. */
export function clearTeamSeedCache(): void {
  nextSeedCheck.clear();
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
    outcome = 'seeded';

    const sources = await getSources(teamId);
    if (sources.length === 0) {
      const connectionId = String(conn._id);

      // EVERY team gets `main` and `hunts` (both org-fenced by their tenant
      // row policies). The platform/admin team ALSO gets the otel sources and
      // ClickHouse's own system database; tenant teams never do.
      //
      // This set is the deployment's fixed floor - the tables the engine
      // bootstraps whether or not an operator ever defines a source. Everything
      // an operator DOES define arrives through PUT /dfe/sources/:name and is
      // seeded below from the manifest, so it is not added to this array.
      const sourceSpecs: Record<string, unknown>[] = [
        defaultSource(connectionId),
        huntsSource(connectionId),
      ];
      if (isPlatformReader(material.username)) {
        sourceSpecs.push(
          otelLogsSource(connectionId),
          otelTracesSource(connectionId),
          otelMetricsSource(connectionId),
          clickhouseSystemSource(connectionId),
        );
      }

      for (const spec of sourceSpecs) {
        await createSource(teamId, spec as Parameters<typeof createSource>[1]);
      }

      // Sources the engine registered before this team existed. The engine's
      // PUT /dfe/sources/:name only reaches the teams present when it ran, so a
      // team created later picks the rest up here.
      await seedDfeSources(teamId, connectionId);

      // The cron would otherwise leave the new team's first page load empty.
      const dashboardDir = process.env.DASHBOARD_PROVISIONER_DIR;
      if (dashboardDir) {
        await syncDashboards(
          teamId,
          dashboardDir,
          process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS === 'true',
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err, teamId },
      'DFE: org connection provisioning failed (non-fatal)',
    );
  }
  return outcome;
}
