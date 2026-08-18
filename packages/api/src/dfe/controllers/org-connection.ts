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
function engineOrigin(): string | undefined {
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

// One generic log source over dfe.default, pointed at the team's single
// connection - the per-team equivalent of the DEFAULT_SOURCES template.
function eventsSource(connectionId: string) {
  return {
    name: 'events',
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

/**
 * Ensure the caller's team holds ONLY its own org connection (plus one source).
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
      await createSource(
        teamId,
        eventsSource(String(conn._id)) as Parameters<typeof createSource>[1],
      );
    }
  } catch (err) {
    logger.warn(
      { err, teamId },
      'DFE: org connection provisioning failed (non-fatal)',
    );
  }
}
