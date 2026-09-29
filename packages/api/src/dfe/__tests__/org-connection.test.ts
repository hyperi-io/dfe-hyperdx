/**
 * DFE per-org connection provisioning.
 *
 * The invariant: a team is seeded with ONLY its own org connection (fetched from
 * the engine with the caller's token) and only when it has none, so a team never
 * ends up holding another org's credentials and a login is never blocked on the
 * engine being reachable.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Reading jest.Mock off a mocked module asserts a narrower type than the real
 * export; scoped here rather than relaxed in upstream's eslint config.
 */

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@/controllers/connection', () => ({
  getConnectionsByTeam: jest.fn(),
  createConnection: jest.fn(),
}));

jest.mock('@/controllers/sources', () => ({
  getSources: jest.fn(),
  createSource: jest.fn(),
}));

jest.mock('@/dfe/config', () => ({
  DFE_ENGINE_JWKS_URL: 'http://engine.test:8000/.well-known/jwks.json',
}));

jest.mock('@/tasks/provisionDashboards', () => ({
  syncDashboards: jest.fn(),
}));

jest.mock('@/dfe/controllers/dfe-sources', () => ({
  seedDfeSources: jest.fn(),
}));

jest.mock('@/dfe/models/team-seed', () => ({
  claimTeamSeed: jest.fn(),
  markTeamSeeded: jest.fn(),
}));

import {
  createConnection,
  getConnectionsByTeam,
} from '@/controllers/connection';
import { createSource, getSources } from '@/controllers/sources';
import { seedDfeSources } from '@/dfe/controllers/dfe-sources';
import {
  clearTeamSeedCache,
  ensureOrgConnection,
  seedTeam,
} from '@/dfe/controllers/org-connection';
import { claimTeamSeed, markTeamSeeded } from '@/dfe/models/team-seed';
import { syncDashboards } from '@/tasks/provisionDashboards';
import logger from '@/utils/logger';

const mockConns = getConnectionsByTeam as jest.Mock;
const mockCreateConn = createConnection as jest.Mock;
const mockSources = getSources as jest.Mock;
const mockCreateSource = createSource as jest.Mock;
const mockSyncDashboards = syncDashboards as jest.Mock;
const mockSeedDfeSources = seedDfeSources as jest.Mock;
const mockClaim = claimTeamSeed as jest.Mock;
const mockMarkSeeded = markTeamSeeded as jest.Mock;
const mockWarn = logger.warn as jest.Mock;

const ORG_CONN = {
  name: 'acme',
  host: 'http://ch:8123',
  username: 'dfe_org_acme',
  password: 'pw',
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  // A copy, so a test can set the provisioner env and restoreAllMocks undoes it.
  jest.replaceProperty(process, 'env', { ...process.env });
  delete process.env.DASHBOARD_PROVISIONER_DIR;
  delete process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS;
});

afterEach(() => {
  jest.restoreAllMocks();
});

function okFetch(body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

const PLATFORM_CONN = {
  name: 'platform',
  host: 'http://ch:8123',
  username: 'dfe_query_reader',
  password: 'pw',
};

describe('ensureOrgConnection', () => {
  test('a tenant team is seeded with the org connection + ONLY the DFE sources', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    expect(global.fetch).toHaveBeenCalledWith(
      'http://engine.test:8000/api/v1/hyperdx/connection',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
    expect(mockCreateConn).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({ username: 'dfe_org_acme', name: 'acme' }),
    );
    // A tenant gets `main` + `hunts` only - never the otel sources.
    const seeded = mockCreateSource.mock.calls.map(c => c[1].name);
    expect(seeded).toEqual(['main', 'hunts']);
    // DFE sources surface the structured `_json`, never `_raw` or the header
    // plumbing (_org_id/_source/_uuid/_tags): `_json` is the body, implicit
    // column and the default view for `main`.
    expect(mockCreateSource).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({
        connection: 'conn-1',
        name: 'main',
        bodyExpression: '_json',
        implicitColumnExpression: '_json',
        defaultTableSelectExpression: '_timestamp,_json',
      }),
    );
    const hunts = mockCreateSource.mock.calls.find(c => c[1].name === 'hunts');
    expect(hunts?.[1].defaultTableSelectExpression).toBe(
      '_timestamp,severity,hunt_name,rule_name,source_table,matched_uuid,rule_id,_json',
    );
    expect(hunts?.[1].defaultTableSelectExpression).not.toContain('_org_id');
  });

  test('both DFE sources sit in the engine data database', async () => {
    // The engine builds `detection` in the data database, so a `dfe_hunts`
    // database exists nowhere and Hunt Results queried a missing table.
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    const from = (name: string) =>
      mockCreateSource.mock.calls.find(c => c[1].name === name)?.[1].from;
    expect(from('hunts')).toEqual({
      databaseName: 'dfe',
      tableName: 'detection',
    });
    expect(from('hunts').databaseName).toBe(from('main').databaseName);
  });

  test('the platform team ALSO gets the otel sources and the system database', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(PLATFORM_CONN);

    await ensureOrgConnection('tok', 'team-1');

    // main + hunts (every team) then the platform-only set, all on one connection.
    const seeded = mockCreateSource.mock.calls.map(c => c[1].name);
    expect(seeded).toEqual([
      'main',
      'hunts',
      'otel_logs',
      'otel_traces',
      'otel_metrics',
      'clickhouse_system',
    ]);
    expect(mockCreateSource).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({ connection: 'conn-1', kind: 'trace' }),
    );
    expect(mockCreateSource).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({
        name: 'clickhouse_system',
        from: { databaseName: 'system', tableName: 'text_log' },
      }),
    );
  });

  test('a tenant team never gets the system database', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    const seeded = mockCreateSource.mock.calls.map(c => c[1].name);
    expect(seeded).not.toContain('clickhouse_system');
  });

  test('is a no-op when the team already has a connection', async () => {
    mockConns.mockResolvedValue([{ _id: 'existing' }]);

    await expect(ensureOrgConnection('tok', 'team-1')).resolves.toBe(true);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConn).not.toHaveBeenCalled();
  });

  test("never adds a caller's org connection beside another org's", async () => {
    // Two members of one team can resolve to different orgs; a second
    // connection would hand every member the other org's rows.
    mockConns.mockResolvedValue([{ _id: 'acme-conn', name: 'acme' }]);
    okFetch(PLATFORM_CONN);

    await expect(ensureOrgConnection('tok', 'team-1')).resolves.toBe(true);

    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('reports a seeded team as done', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await expect(ensureOrgConnection('tok', 'team-1')).resolves.toBe(true);
  });

  test('creates nothing when the engine refuses (non-fatal)', async () => {
    mockConns.mockResolvedValue([]);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });

    await expect(ensureOrgConnection('tok', 'team-1')).resolves.toBe(false);

    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('creates no sources when the team already has some', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([{ _id: 'existing-source' }]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('provisions the shipped dashboards when a new team is seeded', async () => {
    // The provisioner cron fires once a minute with no run at start, so the
    // page's first GET /dashboards, one second after the team is created, saw
    // [] and the SPA cached it.
    process.env.DASHBOARD_PROVISIONER_DIR = '/dashboards';
    process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS = 'true';
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    expect(mockSyncDashboards).toHaveBeenCalledTimes(1);
    expect(mockSyncDashboards).toHaveBeenCalledWith(
      'team-1',
      '/dashboards',
      true,
    );
    // Sources land before the sync so the dashboard refs can resolve.
    expect(mockCreateSource).toHaveBeenCalledTimes(2);
    const syncOrder = mockSyncDashboards.mock.invocationCallOrder[0];
    for (const order of mockCreateSource.mock.invocationCallOrder) {
      expect(order).toBeLessThan(syncOrder);
    }
  });

  test('passes the require-refs flag as false when it is unset', async () => {
    process.env.DASHBOARD_PROVISIONER_DIR = '/dashboards';
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    expect(mockSyncDashboards).toHaveBeenCalledWith(
      'team-1',
      '/dashboards',
      false,
    );
  });

  test('provisions no dashboards when no provisioner directory is set', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    expect(mockCreateSource).toHaveBeenCalledTimes(2);
    expect(mockSyncDashboards).not.toHaveBeenCalled();
  });

  test('provisions no dashboards for a team that already has sources', async () => {
    // An existing team must not be re-synced on every login.
    process.env.DASHBOARD_PROVISIONER_DIR = '/dashboards';
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([{ _id: 'existing-source' }]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    expect(mockSyncDashboards).not.toHaveBeenCalled();
  });

  test('a dashboard sync failure is logged and never blocks seeding', async () => {
    process.env.DASHBOARD_PROVISIONER_DIR = '/dashboards';
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);
    const boom = new Error('dashboard dir unreadable');
    mockSyncDashboards.mockRejectedValue(boom);

    await expect(ensureOrgConnection('tok', 'team-1')).resolves.toBe(false);

    expect(mockCreateConn).toHaveBeenCalledTimes(1);
    expect(mockCreateSource).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, teamId: 'team-1' }),
      'DFE: org connection provisioning failed (non-fatal)',
    );
  });

  test('refuses connection material with no password', async () => {
    // The hand-rolled guard this replaced checked name/host/username and not
    // password, so an engine response missing it stored `undefined` as the
    // ClickHouse password.
    mockConns.mockResolvedValue([]);
    okFetch({ name: 'acme', host: 'http://ch:8123', username: 'dfe_org_acme' });

    await ensureOrgConnection('tok', 'team-1');

    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('swallows a thrown controller error so login is never blocked', async () => {
    mockConns.mockRejectedValue(new Error('db down'));

    await expect(ensureOrgConnection('tok', 'team-1')).resolves.toBe(false);
  });

  test('a team created later gets the sources the engine already registered', async () => {
    // The engine's PUT /dfe/sources/:name reaches the teams present when it ran;
    // a team created afterwards picks the rest up here.
    process.env.DASHBOARD_PROVISIONER_DIR = '/dashboards';
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    expect(mockSeedDfeSources).toHaveBeenCalledWith('team-1', 'conn-1');
    // Sources land before the sync, registered ones included, or a dashboard
    // over a registered source fails its ref check and is skipped.
    expect(mockSeedDfeSources.mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncDashboards.mock.invocationCallOrder[0],
    );
  });

  test('an existing team is never re-seeded', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([{ _id: 'existing-source' }]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1');

    expect(mockSeedDfeSources).not.toHaveBeenCalled();
  });
});

describe('seedTeam', () => {
  const LEASE_MS = 30_000;
  let now: number;

  beforeEach(() => {
    clearTeamSeedCache();
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
  });

  test('a team whose first attempt was refused is seeded by a later request', async () => {
    mockClaim.mockResolvedValue('claimed');
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    await seedTeam('first', 'team-1');
    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockMarkSeeded).not.toHaveBeenCalled();

    now += LEASE_MS;
    okFetch(ORG_CONN);
    await seedTeam('later', 'team-1');

    expect(mockCreateConn).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({ username: 'dfe_org_acme' }),
    );
    expect(mockMarkSeeded).toHaveBeenCalledWith('team-1');
  });

  test('a seeded team costs no query on later requests', async () => {
    mockClaim.mockResolvedValue('claimed');
    okFetch(ORG_CONN);

    await seedTeam('tok', 'team-1');
    mockClaim.mockClear();
    mockConns.mockClear();
    (global.fetch as jest.Mock).mockClear();

    await seedTeam('tok', 'team-1');

    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockConns).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an unseeded team is retried at most once per lease', async () => {
    mockClaim.mockResolvedValue('claimed');
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });

    await seedTeam('tok', 'team-1');
    now += LEASE_MS - 1;
    await seedTeam('tok', 'team-1');

    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a team another request is seeding is left to it', async () => {
    mockClaim.mockResolvedValue('busy');

    await seedTeam('tok', 'team-1');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConn).not.toHaveBeenCalled();
  });

  test('a team seeded elsewhere is remembered without asking the engine', async () => {
    mockClaim.mockResolvedValue('seeded');

    await seedTeam('tok', 'team-1');
    await seedTeam('tok', 'team-1');

    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockMarkSeeded).not.toHaveBeenCalled();
  });

  test('a team already holding a connection is marked seeded', async () => {
    mockClaim.mockResolvedValue('claimed');
    mockConns.mockResolvedValue([{ _id: 'existing', name: 'acme' }]);

    await seedTeam('tok', 'team-1');

    expect(mockMarkSeeded).toHaveBeenCalledWith('team-1');
    expect(mockCreateConn).not.toHaveBeenCalled();
  });

  test('a claim failure is logged and never blocks the login', async () => {
    const boom = new Error('ferretdb down');
    mockClaim.mockRejectedValue(boom);

    await expect(seedTeam('tok', 'team-1')).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, teamId: 'team-1' }),
      'DFE: team seeding failed (non-fatal)',
    );
  });
});
