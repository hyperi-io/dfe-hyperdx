// DFE per-org ClickHouse connection provisioning.
//
// The engine is the SOLE source of a team's ClickHouse connection: the fork asks
// the engine for the CALLER's own org connection and seeds exactly that on the
// caller's team, so a team never holds another org's credentials. This is the
// fork half of the per-org connection seam (dfe-engine#124) - it replaces the
// global DEFAULT_CONNECTIONS blob that handed every team every org's connection.
//
// This is a NEW file - it does not modify any upstream HyperDX files.
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Bridging the engine's JSON response and the loosely-typed connection/source
 * controllers means asserting narrower types than their broad exports.
 */

import {
  createConnection,
  getConnectionsByTeam,
} from '@/controllers/connection';
import { createSource, getSources } from '@/controllers/sources';
import * as dfeConfig from '@/dfe/config';
import logger from '@/utils/logger';

interface OrgConnection {
  name: string;
  host: string;
  username: string;
  password: string;
}

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

async function fetchOrgConnection(
  token: string,
): Promise<OrgConnection | undefined> {
  const origin = engineOrigin();
  if (!origin) {
    return undefined;
  }
  try {
    const resp = await fetch(`${origin}/api/v1/hyperdx/connection`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    if (!resp.ok) {
      logger.warn(
        { status: resp.status },
        'DFE: engine connection endpoint refused',
      );
      return undefined;
    }
    const data = (await resp.json()) as OrgConnection;
    if (!data?.name || !data?.host || !data?.username) {
      return undefined;
    }
    return data;
  } catch (err) {
    logger.warn({ err }, 'DFE: engine connection endpoint unreachable');
    return undefined;
  }
}

// The engine returns this ClickHouse username for the PLATFORM/admin team - the
// unrestricted reader that sees every org's rows. Any other username (the
// per-org dfe_org_<org> readers) is a tenant, row-policy fenced to one org.
const PLATFORM_READER_USERNAME = 'dfe_query_reader';

// The OTel database. Renamed from `default` to `dfe`, so every otel_* table is
// dfe.otel_*. Kept as one constant so the rename lands in a single place.
const OTEL_DATABASE = 'dfe';

// A team is the platform/admin team iff its connection reads as the unrestricted
// platform reader. Anything else (including the dfe_org_<org> tenant readers, or
// an unrecognised username) is treated as a tenant and gets ONLY `events` - otel
// is unfenced operator telemetry and must never reach an org_viewer.
function isPlatformReader(username: string): boolean {
  return username === PLATFORM_READER_USERNAME;
}

// One generic log source over dfe.default, pointed at the team's single
// connection - the per-team equivalent of the DEFAULT_SOURCES template. EVERY
// team gets this, platform and tenant alike. NAMED `default` to match the CH
// table (dfe.default) and the receiver/engine `default_source: default`
// convention - one name for the catch-all source across the whole suite. A
// future suite-wide rename to `events` is a separate coordinated change.
function defaultSource(connectionId: string) {
  return {
    name: 'default',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: 'dfe', tableName: 'default' },
    timestampValueExpression: '_timestamp',
    displayedTimestampValueExpression: '_timestamp',
    implicitColumnExpression: '_raw',
    bodyExpression: '_raw',
    defaultTableSelectExpression: '_timestamp,_org_id,_source,_raw',
  };
}

// The hunt-detection source over dfe_hunts.detection (security-hunt matches).
// Seeded on EVERY team like `default`, and org-fenced the same way: the tenant
// row policy on dfe_hunts.detection scopes a tenant to its own _org_id while the
// platform reader sees every org. Interim hard-coding per the source-manifest
// TODO below - hunts is one of the DFE tables the engine will later own.
function huntsSource(connectionId: string) {
  return {
    name: 'hunts',
    kind: 'log',
    connection: connectionId,
    from: { databaseName: 'dfe_hunts', tableName: 'detection' },
    timestampValueExpression: '_timestamp',
    displayedTimestampValueExpression: '_timestamp',
    implicitColumnExpression: 'rule_name',
    bodyExpression: '_json',
    defaultTableSelectExpression:
      '_timestamp,_org_id,severity,hunt_name,rule_name,_source',
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
 * Ensure the caller's team holds ONLY its own org connection, plus its seed
 * sources: `events` for every team, and the otel sources as well for the
 * platform/admin team (see the source builders above for the RBAC split).
 *
 * Idempotent and non-fatal: a team that already has a connection is left alone
 * (the first user seeds it, the rest reuse), and any failure is logged and
 * swallowed so a HyperDX login is never blocked on the engine being reachable.
 */
export async function ensureOrgConnection(
  token: string,
  teamId: string,
): Promise<void> {
  try {
    const existing = await getConnectionsByTeam(teamId);
    if (existing.length > 0) {
      return;
    }

    const material = await fetchOrgConnection(token);
    if (!material) {
      return;
    }

    const conn = await createConnection(teamId, {
      name: material.name,
      host: material.host,
      username: material.username,
      password: material.password,
    } as Parameters<typeof createConnection>[1]);

    const sources = await getSources(teamId);
    if (sources.length === 0) {
      const connectionId = String(conn._id);

      // EVERY team gets `default` and `hunts` (both org-fenced by their tenant
      // row policies). The platform/admin team ALSO gets the otel sources and
      // ClickHouse's own system database; tenant teams never do.
      //
      // TODO(dfe-engine): the seeded source SET is hard-coded here for now -
      // default + hunts + the three otel kinds. The engine will later own the
      // canonical reserved-source-name list (validation) AND the per-deployment
      // source manifest (hunts/rules/other DFE tables, meta-schema ingest) as its
      // SSoT; when that endpoint exists, fetch the list from the engine and seed
      // from it rather than extending this array. This loop is the extension point.
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
    }
  } catch (err) {
    logger.warn(
      { err, teamId },
      'DFE: org connection provisioning failed (non-fatal)',
    );
  }
}
