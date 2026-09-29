/**
 * DFE per-org connection provisioning.
 *
 * The invariant: a team named after a ClickHouse identity is seeded with ONLY a
 * connection as that identity (fetched from the engine with the caller's token),
 * and only when it has none. A team never holds a ClickHouse user other than its
 * name, a failed seed is retried by the next request, and an engine that cannot
 * answer never blocks a login.
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

jest.mock('@/models/connection', () => ({
  __esModule: true,
  default: { collection: { createIndex: jest.fn() } },
}));

import {
  createConnection,
  getConnectionsByTeam,
} from '@/controllers/connection';
import { createSource, getSources } from '@/controllers/sources';
import { seedDfeSources } from '@/dfe/controllers/dfe-sources';
import { ensureOrgConnection } from '@/dfe/controllers/org-connection';
import { syncDashboards } from '@/tasks/provisionDashboards';
import logger from '@/utils/logger';

const mockConns = getConnectionsByTeam as jest.Mock;
const mockCreateConn = createConnection as jest.Mock;
const mockSources = getSources as jest.Mock;
const mockCreateSource = createSource as jest.Mock;
const mockSyncDashboards = syncDashboards as jest.Mock;
const mockSeedDfeSources = seedDfeSources as jest.Mock;
const mockWarn = logger.warn as jest.Mock;
const mockError = logger.error as jest.Mock;

const ORG = 'dfe_org_acme';
const PLATFORM = 'dfe_query_reader';

const ORG_CONN = {
  name: 'acme',
  host: 'http://ch:8123',
  username: ORG,
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
    status: 200,
    json: async () => body,
  });
}

const PLATFORM_CONN = {
  name: 'platform',
  host: 'http://ch:8123',
  username: PLATFORM,
  password: 'pw',
};

describe('ensureOrgConnection - the team identity', () => {
  test('never seeds a connection whose username is not the team name', async () => {
    // A platform admin arriving first on an org team used to seed it with the
    // platform reader for every later member.
    mockConns.mockResolvedValue([]);
    okFetch(PLATFORM_CONN);

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'mismatch',
    );

    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('a team holding a connection as anyone else is a mismatch, never reused', async () => {
    mockConns.mockResolvedValue([{ _id: 'c-1', username: PLATFORM }]);

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'mismatch',
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ team: ORG, foreign: [PLATFORM] }),
      'DFE: team holds a connection that is not its own ClickHouse identity',
    );
  });

  test('a team holding its own connection is present', async () => {
    mockConns.mockResolvedValue([{ _id: 'c-1', username: ORG }]);

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a failed first seed is retried by the next call', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ORG_CONN,
      });

    const first = await ensureOrgConnection('tok', 'team-1', ORG);
    const second = await ensureOrgConnection('tok', 'team-1', ORG);

    expect(first).toBe('unavailable');
    expect(second).toBe('seeded');
    expect(mockCreateConn).toHaveBeenCalledTimes(1);
  });

  test('a seed that loses the race to another replica is present, not a second connection', async () => {
    mockConns.mockResolvedValue([]);
    okFetch(ORG_CONN);
    mockCreateConn.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
    );

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('concurrent first requests on one team share one seed', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    const outcomes = await Promise.all([
      ensureOrgConnection('tok', 'team-1', ORG),
      ensureOrgConnection('tok', 'team-1', ORG),
      ensureOrgConnection('tok', 'team-1', ORG),
    ]);

    expect(outcomes).toEqual(['seeded', 'seeded', 'seeded']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockCreateConn).toHaveBeenCalledTimes(1);
  });

  test('a refusal from the engine is reported, so the caller can refuse the session', async () => {
    mockConns.mockResolvedValue([]);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'refused',
    );
    expect(mockCreateConn).not.toHaveBeenCalled();
  });

  test.each([500, 502, 503])(
    'an engine %i is unavailable, not a refusal',
    async status => {
      mockConns.mockResolvedValue([]);
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status });

      await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
        'unavailable',
      );
      expect(mockCreateConn).not.toHaveBeenCalled();
    },
  );

  test('never writes the connection password to the log', async () => {
    mockConns.mockResolvedValue([]);
    okFetch({ ...PLATFORM_CONN, password: 'pw-secret' });

    await ensureOrgConnection('tok', 'team-1', ORG);
    okFetch({ name: 'acme', host: 'h', username: ORG, password: 42 });
    await ensureOrgConnection('tok', 'team-2', ORG);

    const logged = JSON.stringify([
      mockWarn.mock.calls,
      mockError.mock.calls,
      (logger.info as jest.Mock).mock.calls,
    ]);
    expect(logged).not.toContain('pw-secret');
    expect(logged).not.toContain('42');
  });
});

type FreshSeed = {
  createIndex: jest.Mock;
  createConnection: jest.Mock;
  ensure: typeof ensureOrgConnection;
};

/**
 * org-connection with its once-per-process index memo unset, over mocks that
 * seed one team with its own connection.
 */
function freshSeed(): FreshSeed {
  let fresh: FreshSeed | undefined;
  jest.isolateModules(() => {
    const model = jest.requireMock<typeof import('@/models/connection')>(
      '@/models/connection',
    );
    const controllers = jest.requireMock<
      typeof import('@/controllers/connection')
    >('@/controllers/connection');
    const sources = jest.requireMock<typeof import('@/controllers/sources')>(
      '@/controllers/sources',
    );
    const orgConnection = jest.requireActual<
      typeof import('@/dfe/controllers/org-connection')
    >('@/dfe/controllers/org-connection');
    (controllers.getConnectionsByTeam as jest.Mock).mockResolvedValue([]);
    (sources.getSources as jest.Mock).mockResolvedValue([{ _id: 's' }]);
    fresh = {
      createIndex: model.default.collection.createIndex as jest.Mock,
      createConnection: (
        controllers.createConnection as jest.Mock
      ).mockResolvedValue({ _id: 'conn-1' }),
      ensure: orgConnection.ensureOrgConnection,
    };
  });
  if (!fresh) {
    throw new Error('jest.isolateModules did not run');
  }
  return fresh;
}

describe('ensureOrgConnection - the one-connection-per-team index', () => {
  test('is ensured before the first connection is created', async () => {
    const seed = freshSeed();
    okFetch(ORG_CONN);

    await expect(seed.ensure('tok', 'team-1', ORG)).resolves.toBe('seeded');

    expect(seed.createIndex).toHaveBeenCalledWith(
      { team: 1 },
      { unique: true, name: 'dfe_one_connection_per_team' },
    );
    expect(seed.createIndex.mock.invocationCallOrder[0]).toBeLessThan(
      seed.createConnection.mock.invocationCallOrder[0],
    );
  });

  test('an index that cannot be built does not block the seed', async () => {
    const seed = freshSeed();
    seed.createIndex.mockRejectedValue(new Error('index build failed'));
    okFetch(ORG_CONN);

    await expect(seed.ensure('tok', 'team-1', ORG)).resolves.toBe('seeded');
    expect(seed.createConnection).toHaveBeenCalledTimes(1);
  });
});

describe('ensureOrgConnection', () => {
  test('a tenant team is seeded with the org connection + ONLY the DFE sources', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1', ORG);

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

    await ensureOrgConnection('tok', 'team-1', ORG);

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

    await ensureOrgConnection('tok', 'team-1', PLATFORM);

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

    await ensureOrgConnection('tok', 'team-1', ORG);

    const seeded = mockCreateSource.mock.calls.map(c => c[1].name);
    expect(seeded).not.toContain('clickhouse_system');
  });

  test('is a no-op when the team already has its own connection', async () => {
    mockConns.mockResolvedValue([{ _id: 'existing', username: ORG }]);

    await ensureOrgConnection('tok', 'team-1', ORG);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConn).not.toHaveBeenCalled();
  });

  test('creates nothing when the engine refuses', async () => {
    mockConns.mockResolvedValue([]);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });

    await ensureOrgConnection('tok', 'team-1', ORG);

    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('creates no sources when the team already has some', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([{ _id: 'existing-source' }]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1', ORG);

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

    await ensureOrgConnection('tok', 'team-1', ORG);

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

    await ensureOrgConnection('tok', 'team-1', ORG);

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

    await ensureOrgConnection('tok', 'team-1', ORG);

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

    await ensureOrgConnection('tok', 'team-1', ORG);

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

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'seeded',
    );

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
    okFetch({ name: 'acme', host: 'http://ch:8123', username: ORG });

    await ensureOrgConnection('tok', 'team-1', ORG);

    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('a store error is unavailable, so login is never blocked', async () => {
    mockConns.mockRejectedValue(new Error('db down'));

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'unavailable',
    );
  });

  test('a team created later gets the sources the engine already registered', async () => {
    // The engine's PUT /dfe/sources/:name reaches the teams present when it ran;
    // a team created afterwards picks the rest up here.
    process.env.DASHBOARD_PROVISIONER_DIR = '/dashboards';
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await ensureOrgConnection('tok', 'team-1', ORG);

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

    await ensureOrgConnection('tok', 'team-1', ORG);

    expect(mockSeedDfeSources).not.toHaveBeenCalled();
  });
});
