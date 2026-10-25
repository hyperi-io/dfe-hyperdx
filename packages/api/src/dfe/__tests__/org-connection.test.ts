/**
 * DFE per-org connection provisioning.
 *
 * The invariant: a team named after a ClickHouse identity is seeded with ONLY a
 * connection as that identity (fetched from the engine with the caller's token),
 * and only when it has none. A team never holds a ClickHouse user other than its
 * name, a team found holding none is seeded again once the claim lapses, and an
 * engine that cannot answer never blocks a login.
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
  getConnectionById: jest.fn(),
  updateConnection: jest.fn(),
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

jest.mock('@/dfe/models/team-seed', () => ({
  claimTeamSeed: jest.fn(),
  awaitTeamSeed: jest.fn(),
  settleTeamSeed: jest.fn(),
}));

import { EventEmitter } from 'node:events';

import type { Response } from 'express';

import {
  createConnection,
  getConnectionById,
  getConnectionsByTeam,
  updateConnection,
} from '@/controllers/connection';
import { createSource, getSources } from '@/controllers/sources';
import { seedDfeSources } from '@/dfe/controllers/dfe-sources';
import {
  clearTeamSeedCache,
  ensureOrgConnection,
  recheckOnAuthFailure,
} from '@/dfe/controllers/org-connection';
import {
  awaitTeamSeed,
  claimTeamSeed,
  settleTeamSeed,
} from '@/dfe/models/team-seed';
import { syncDashboards } from '@/tasks/provisionDashboards';
import logger from '@/utils/logger';

const mockConns = getConnectionsByTeam as jest.Mock;
const mockCreateConn = createConnection as jest.Mock;
const mockSources = getSources as jest.Mock;
const mockCreateSource = createSource as jest.Mock;
const mockSyncDashboards = syncDashboards as jest.Mock;
const mockSeedDfeSources = seedDfeSources as jest.Mock;
const mockClaim = claimTeamSeed as jest.Mock;
const mockAwaitSeed = awaitTeamSeed as jest.Mock;
const mockSettle = settleTeamSeed as jest.Mock;
const mockConnById = getConnectionById as jest.Mock;
const mockUpdateConn = updateConnection as jest.Mock;
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
  clearTeamSeedCache();
  mockClaim.mockResolvedValue('claimed');
  mockAwaitSeed.mockResolvedValue('idle');
  mockSettle.mockResolvedValue(undefined);
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

  test('concurrent first requests on one team seed it once, and the others wait for that seed', async () => {
    // A loser answering before the winner seeds the sources hands the page a half-seeded team.
    mockConns
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ _id: 'conn-1', username: ORG }]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    mockClaim
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce('busy')
      .mockResolvedValueOnce('busy');
    okFetch(ORG_CONN);
    const events: string[] = [];
    let settle = () => {};
    const settled = new Promise<void>(resolve => {
      settle = resolve;
    });
    mockSettle.mockImplementation(async () => {
      events.push('settled');
      settle();
    });
    mockAwaitSeed.mockImplementation(async () => {
      await settled;
      return 'settled';
    });

    const outcomes = await Promise.all(
      [1, 2, 3].map(() =>
        ensureOrgConnection('tok', 'team-1', ORG).then(outcome => {
          events.push(outcome);
          return outcome;
        }),
      ),
    );

    expect(outcomes).toEqual(['seeded', 'present', 'present']);
    expect(events[0]).toBe('settled');
    expect(mockSeedDfeSources.mock.invocationCallOrder[0]).toBeLessThan(
      mockSettle.mock.invocationCallOrder[0],
    );
    expect(mockAwaitSeed).toHaveBeenCalledTimes(2);
    expect(mockAwaitSeed).toHaveBeenCalledWith('team-1', 30_000);
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
 * grant the seed claim and seed one team with its own connection.
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
    const teamSeed = jest.requireMock<typeof import('@/dfe/models/team-seed')>(
      '@/dfe/models/team-seed',
    );
    const orgConnection = jest.requireActual<
      typeof import('@/dfe/controllers/org-connection')
    >('@/dfe/controllers/org-connection');
    (teamSeed.claimTeamSeed as jest.Mock).mockResolvedValue('claimed');
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

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConn).not.toHaveBeenCalled();
  });

  test("never adds a caller's connection beside another org's", async () => {
    // A second connection would hand every member the other org's rows.
    mockConns.mockResolvedValue([{ _id: 'acme-conn', username: ORG }]);
    okFetch(PLATFORM_CONN);

    await expect(ensureOrgConnection('tok', 'team-1', PLATFORM)).resolves.toBe(
      'mismatch',
    );

    expect(mockCreateConn).not.toHaveBeenCalled();
    expect(mockCreateSource).not.toHaveBeenCalled();
  });

  test('reports a team this call gave a connection as seeded', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(ORG_CONN);

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'seeded',
    );
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

describe('ensureOrgConnection - the seed claim', () => {
  const LEASE_MS = 30_000;
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
  });

  test('a team whose first attempt failed is seeded by a later request', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new TypeError('fetch failed'),
    );

    await expect(ensureOrgConnection('first', 'team-1', ORG)).resolves.toBe(
      'unavailable',
    );
    expect(mockCreateConn).not.toHaveBeenCalled();

    now += LEASE_MS;
    okFetch(ORG_CONN);
    await expect(ensureOrgConnection('later', 'team-1', ORG)).resolves.toBe(
      'seeded',
    );

    expect(mockCreateConn).toHaveBeenCalledTimes(1);
    expect(mockCreateConn).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({ username: ORG }),
    );
  });

  test('a seeded team takes no claim and no engine call on later requests', async () => {
    okFetch(ORG_CONN);
    await ensureOrgConnection('tok', 'team-1', ORG);
    mockConns.mockResolvedValue([{ _id: 'conn-1', username: ORG }]);
    mockClaim.mockClear();
    (global.fetch as jest.Mock).mockClear();

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );

    expect(mockClaim).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a team whose connection was deleted is seeded again', async () => {
    okFetch(ORG_CONN);
    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'seeded',
    );

    // Deleted since: the team holds nothing, whatever the last attempt did.
    mockConns.mockResolvedValue([]);
    now += LEASE_MS;
    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'seeded',
    );

    expect(mockClaim).toHaveBeenCalledTimes(2);
    expect(mockCreateConn).toHaveBeenCalledTimes(2);
  });

  test('an unseeded team is claimed at most once per lease', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });

    await ensureOrgConnection('tok', 'team-1', ORG);
    now += LEASE_MS - 1;
    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'unavailable',
    );

    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('a team another request is seeding is left to it', async () => {
    mockClaim.mockResolvedValue('busy');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'unavailable',
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConn).not.toHaveBeenCalled();
  });

  test('a claim failure is logged and never blocks the login', async () => {
    const boom = new Error('ferretdb down');
    mockClaim.mockRejectedValue(boom);

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'unavailable',
    );

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, teamId: 'team-1' }),
      'DFE: team seeding failed (non-fatal)',
    );
  });
});

describe("ensureOrgConnection - another request's seed in flight", () => {
  const OWN = [{ _id: 'conn-1', username: ORG }];

  test('a request that finds the connection waits for the seed to settle before answering', async () => {
    mockConns.mockResolvedValue(OWN);
    let release = (_wait: string) => {};
    mockAwaitSeed.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      }),
    );
    let answered = false;

    const pending = ensureOrgConnection('tok', 'team-1', ORG).then(outcome => {
      answered = true;
      return outcome;
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(answered).toBe(false);

    release('settled');
    await expect(pending).resolves.toBe('present');
    expect(mockAwaitSeed).toHaveBeenCalledWith('team-1', 30_000);
  });

  test('a team seen settled is not read again by this process', async () => {
    mockConns.mockResolvedValue(OWN);

    await ensureOrgConnection('tok', 'team-1', ORG);
    await ensureOrgConnection('tok', 'team-1', ORG);

    expect(mockAwaitSeed).toHaveBeenCalledTimes(1);
  });

  test('a seed that never settles on a busy claim falls back to unavailable, logged once', async () => {
    mockConns.mockResolvedValue([]);
    mockClaim.mockResolvedValue('busy');
    mockAwaitSeed.mockResolvedValue('timeout');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'unavailable',
    );

    const gaveUp = mockWarn.mock.calls.filter(
      call =>
        call[1] ===
        'DFE: another request seeding the team did not finish; going on without it',
    );
    expect(gaveUp).toHaveLength(1);
    expect(gaveUp[0]?.[0]).toEqual({ teamId: 'team-1' });
    expect(mockConns).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a seed that never settles on a held connection still answers present', async () => {
    mockConns.mockResolvedValue(OWN);
    mockAwaitSeed.mockResolvedValue('timeout');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );
    expect(mockWarn).toHaveBeenCalledWith(
      { teamId: 'team-1' },
      'DFE: another request seeding the team did not finish; going on without it',
    );
  });

  test('a claim the store cannot read never fails the request', async () => {
    const boom = new Error('documentdb down');
    mockConns.mockResolvedValue(OWN);
    mockAwaitSeed.mockRejectedValue(boom);

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );
    expect(mockWarn).toHaveBeenCalledWith(
      { err: boom, teamId: 'team-1' },
      'DFE: could not read the team seed claim',
    );
  });

  test('the request holding the claim settles it even when the seed fails', async () => {
    mockConns.mockResolvedValue([]);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'unavailable',
    );
    expect(mockSettle).toHaveBeenCalledWith('team-1');
    expect(mockAwaitSeed).not.toHaveBeenCalled();
  });
});

/** A finished proxy response for `teamId`, carrying ClickHouse's exception code if any. */
function finishResponse(teamId: string, exceptionCode?: string) {
  const res = Object.assign(new EventEmitter(), {
    getHeader: (name: string) =>
      name === 'x-clickhouse-exception-code' ? exceptionCode : undefined,
  });
  recheckOnAuthFailure(res as unknown as Response, teamId);
  res.emit('finish');
}

describe('ensureOrgConnection - a held connection ClickHouse refuses', () => {
  // The engine replaces the platform reader's password from the deployment's
  // value, and the team's stored copy has to follow it.
  const INTERVAL_MS = 30_000;
  const STORED = {
    _id: 'c-1',
    host: 'http://ch:8123',
    username: ORG,
    password: 'pw-old',
  };
  let now: number;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockConns.mockResolvedValue([{ _id: 'c-1', username: ORG }]);
    mockConnById.mockResolvedValue(STORED);
    mockUpdateConn.mockResolvedValue(STORED);
  });

  test('is not re-checked while ClickHouse accepts it', async () => {
    finishResponse('team-1');
    finishResponse('team-1', '60');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockUpdateConn).not.toHaveBeenCalled();
  });

  test('an auth failure re-checks it on the next request, once', async () => {
    okFetch({ ...ORG_CONN, password: 'pw-new' });

    await ensureOrgConnection('tok', 'team-1', ORG);
    expect(global.fetch).not.toHaveBeenCalled();

    finishResponse('team-1', '516');
    await ensureOrgConnection('tok', 'team-1', ORG);
    await ensureOrgConnection('tok', 'team-1', ORG);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://engine.test:8000/api/v1/hyperdx/connection',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }),
    );
    expect(mockUpdateConn).toHaveBeenCalledTimes(1);
  });

  test('a refusal on one team re-checks no other', async () => {
    finishResponse('team-2', '516');

    await ensureOrgConnection('tok', 'team-1', ORG);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('present and unchanged: nothing is written', async () => {
    okFetch({ ...ORG_CONN, password: 'pw-old' });
    finishResponse('team-1', '516');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );

    expect(mockConnById).toHaveBeenCalledWith('team-1', 'c-1', true);
    expect(mockUpdateConn).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-1', team: ORG }),
      'DFE: ClickHouse refused a team connection that matches the engine',
    );
  });

  test('present and the password changed: the stored connection is updated in place', async () => {
    okFetch({ ...ORG_CONN, password: 'pw-new' });
    finishResponse('team-1', '516');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );

    expect(mockUpdateConn).toHaveBeenCalledWith('team-1', 'c-1', {
      host: 'http://ch:8123',
      password: 'pw-new',
    });
    expect(mockCreateConn).not.toHaveBeenCalled();
    const logged = JSON.stringify([
      mockWarn.mock.calls,
      mockError.mock.calls,
      (logger.info as jest.Mock).mock.calls,
    ]);
    expect(logged).not.toContain('pw-new');
    expect(logged).not.toContain('pw-old');
  });

  test('never updates it to a ClickHouse user other than the team name', async () => {
    okFetch({ ...PLATFORM_CONN, password: 'pw-new' });
    finishResponse('team-1', '516');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );

    expect(mockUpdateConn).not.toHaveBeenCalled();
  });

  test('a re-check the engine cannot answer is logged, and not retried in a loop', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 503 });
    finishResponse('team-1', '516');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 'team-1', outcome: 'unavailable' }),
      'DFE: could not re-check a team connection ClickHouse refused',
    );

    // ClickHouse keeps refusing: the engine is asked again only once the interval passes.
    for (let i = 0; i < 5; i += 1) {
      finishResponse('team-1', '516');
      await ensureOrgConnection('tok', 'team-1', ORG);
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);

    now += INTERVAL_MS;
    await ensureOrgConnection('tok', 'team-1', ORG);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockUpdateConn).not.toHaveBeenCalled();
  });

  test('an update the store fails is logged and never blocks the login', async () => {
    const boom = new Error('ferretdb down');
    okFetch({ ...ORG_CONN, password: 'pw-new' });
    mockUpdateConn.mockRejectedValue(boom);
    finishResponse('team-1', '516');

    await expect(ensureOrgConnection('tok', 'team-1', ORG)).resolves.toBe(
      'present',
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ err: boom, teamId: 'team-1' }),
      'DFE: re-checking a refused team connection failed',
    );
  });
});
