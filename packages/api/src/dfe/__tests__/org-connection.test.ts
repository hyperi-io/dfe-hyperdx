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

import {
  createConnection,
  getConnectionsByTeam,
} from '@/controllers/connection';
import { createSource, getSources } from '@/controllers/sources';
import { ensureOrgConnection } from '@/dfe/controllers/org-connection';

const mockConns = getConnectionsByTeam as jest.Mock;
const mockCreateConn = createConnection as jest.Mock;
const mockSources = getSources as jest.Mock;
const mockCreateSource = createSource as jest.Mock;

const ORG_CONN = {
  name: 'acme',
  host: 'http://ch:8123',
  username: 'dfe_org_acme',
  password: 'pw',
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
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
  test('a tenant team is seeded with the org connection + ONLY the default source', async () => {
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
    // A tenant gets `default` + `hunts` only - never the otel sources.
    const seeded = mockCreateSource.mock.calls.map(c => c[1].name);
    expect(seeded).toEqual(['default', 'hunts']);
    expect(mockCreateSource).toHaveBeenCalledWith(
      'team-1',
      expect.objectContaining({ connection: 'conn-1', name: 'default' }),
    );
  });

  test('the platform team ALSO gets the otel sources and the system database', async () => {
    mockConns.mockResolvedValue([]);
    mockCreateConn.mockResolvedValue({ _id: 'conn-1' });
    mockSources.mockResolvedValue([]);
    okFetch(PLATFORM_CONN);

    await ensureOrgConnection('tok', 'team-1');

    // default + hunts (every team) then the platform-only set, all on one connection.
    const seeded = mockCreateSource.mock.calls.map(c => c[1].name);
    expect(seeded).toEqual([
      'default',
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

    await ensureOrgConnection('tok', 'team-1');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCreateConn).not.toHaveBeenCalled();
  });

  test('creates nothing when the engine refuses (non-fatal)', async () => {
    mockConns.mockResolvedValue([]);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });

    await ensureOrgConnection('tok', 'team-1');

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

  test('swallows a thrown controller error so login is never blocked', async () => {
    mockConns.mockRejectedValue(new Error('db down'));

    await expect(ensureOrgConnection('tok', 'team-1')).resolves.toBeUndefined();
  });
});
