/**
 * DFE e2e fixture: a table whose body is a NATIVE ClickHouse JSON column.
 *
 * Upstream's seed covers JSON parsed out of a String column and a couple of
 * native JSON attribute columns. It does not cover a source whose body IS a
 * JSON column, which is the shape every DFE source uses (`dfe.default._json`).
 *
 * Seeded from here rather than by extending `seed-clickhouse.ts`, so upstream's
 * seed stays pristine.
 *
 * `src.port` and `duration_ms` deliberately hold a DIFFERENT type in different
 * rows. That is what separates `toString()` from the `.:String` typed
 * sub-column: the typed one reads NULL for every row not stored as that type,
 * so a regression to it silently under-matches instead of failing.
 */
import { E2E_CLICKHOUSE_DATABASE } from './utils/constants';

export const DFE_JSON_TABLE = 'dfe_json_e2e_events';
export const DFE_JSON_SOURCE_NAME = 'DFE Native JSON';

/**
 * Rows sit mostly in the recent past, with a small future tail so the fixture
 * does not age out mid-run. Weighted this way because the relative ranges the
 * specs use all look BACKWARDS from now, and `getJSONKeys` caches its result
 * without the date range -- so a window that finds nothing on the first call
 * leaves the sidebar empty for the rest of the page's life.
 */
const PAST_MS = 50 * 60 * 1000;
const FUTURE_MS = 10 * 60 * 1000;
const ROW_COUNT = 60;

export const DFE_JSON_USERS = ['alice', 'bob', 'carol'] as const;
export const DFE_JSON_ACTIONS = ['login', 'logout', 'file.read'] as const;

/** A user with a known row count, for asserting a filter actually narrowed. */
export const DFE_JSON_FILTER_USER = 'alice';
export const DFE_JSON_FILTER_USER_ROWS = ROW_COUNT / DFE_JSON_USERS.length;

const CLICKHOUSE_URL =
  process.env.CLICKHOUSE_HOST ||
  `http://localhost:${process.env.HDX_E2E_CH_PORT || '20500'}`;

async function query(sql: string): Promise<string> {
  const url = new URL(CLICKHOUSE_URL);
  url.searchParams.set('user', process.env.CLICKHOUSE_USER || 'default');
  if (process.env.CLICKHOUSE_PASSWORD) {
    url.searchParams.set('password', process.env.CLICKHOUSE_PASSWORD);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    body: sql,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!response.ok) {
    throw new Error(
      `DFE JSON seed query failed (${response.status}): ${await response.text()}`,
    );
  }
  return response.text();
}

function rowValues(index: number, seedRef: number): string {
  const spread = (PAST_MS + FUTURE_MS) / ROW_COUNT;
  const timestamp = seedRef - PAST_MS + index * spread;

  const user = DFE_JSON_USERS[index % DFE_JSON_USERS.length];
  const action = DFE_JSON_ACTIONS[index % DFE_JSON_ACTIONS.length];
  const port = 1024 + index;
  // Every third row stores the port as text and the duration as an integer.
  const mixed = index % 3 === 0;
  const body = JSON.stringify({
    user: { name: user, id: 1000 + index },
    event: { action, outcome: index % 7 === 0 ? 'failure' : 'success' },
    src: { ip: `10.1.0.${index}`, port: mixed ? String(port) : port },
    duration_ms: mixed ? index : Number((index + 0.25).toFixed(2)),
    ok: index % 7 !== 0,
  });

  return `(fromUnixTimestamp64Milli(${Math.round(timestamp)}), 'dfe-json-e2e', '${body.replace(/'/g, "\\'")}')`;
}

/** Create and fill the native-JSON table. Safe to re-run: it replaces the table. */
export async function seedDfeJson(seedRef = Date.now()): Promise<void> {
  await query(`CREATE DATABASE IF NOT EXISTS ${E2E_CLICKHOUSE_DATABASE}`);
  await query(`
    CREATE OR REPLACE TABLE ${E2E_CLICKHOUSE_DATABASE}.${DFE_JSON_TABLE}
    (
      Timestamp   DateTime64(3, 'UTC'),
      ServiceName LowCardinality(String),
      Body        JSON
    )
    ENGINE = MergeTree
    ORDER BY Timestamp
  `);

  const rows = Array.from({ length: ROW_COUNT }, (_, i) =>
    rowValues(i, seedRef),
  );
  await query(
    `INSERT INTO ${E2E_CLICKHOUSE_DATABASE}.${DFE_JSON_TABLE} (Timestamp, ServiceName, Body) VALUES ${rows.join(', ')}`,
  );
}

/** The source body HyperDX needs to expose the table above. */
export function dfeJsonSourceBody(connectionId: string) {
  return {
    name: DFE_JSON_SOURCE_NAME,
    kind: 'log',
    connection: connectionId,
    from: { databaseName: E2E_CLICKHOUSE_DATABASE, tableName: DFE_JSON_TABLE },
    timestampValueExpression: 'Timestamp',
    displayedTimestampValueExpression: 'Timestamp',
    serviceNameExpression: 'ServiceName',
    bodyExpression: 'Body',
    eventAttributesExpression: 'Body',
    implicitColumnExpression: 'Body',
    defaultTableSelectExpression: 'Timestamp, ServiceName, Body',
  };
}
