/**
 * The startup repair of group-seeded team connections.
 *
 * The invariants: every connection whose username is not its team's name is
 * deleted, and every other one is kept; users and content are never touched;
 * each deletion is logged with the team, the username and the member count,
 * never a password; and the repair runs once, in oidc-proxy mode alone.
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

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  DFE_AUTH_MODE: 'oidc-proxy',
}));

jest.mock('@/dfe/controllers/org-connection', () => ({
  ensureOneConnectionPerTeam: jest.fn(async () => true),
}));

jest.mock('@/models', () => ({
  mongooseConnection: { readyState: 0, once: jest.fn() },
}));

const lean = (rows: unknown[]) => ({ lean: jest.fn(async () => rows) });

jest.mock('@/models/team', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('@/models/connection', () => ({
  __esModule: true,
  default: { find: jest.fn(), deleteOne: jest.fn() },
}));
jest.mock('@/models/user', () => ({
  __esModule: true,
  default: { countDocuments: jest.fn() },
}));
jest.mock('@/models/source', () => ({ Source: { countDocuments: jest.fn() } }));
jest.mock('@/models/savedSearch', () => ({
  SavedSearch: { countDocuments: jest.fn() },
}));
jest.mock('@/models/dashboard', () => ({
  __esModule: true,
  default: { countDocuments: jest.fn() },
}));
jest.mock('@/models/alert', () => ({
  __esModule: true,
  default: { countDocuments: jest.fn() },
}));

import * as dfeConfig from '@/dfe/config';
import { ensureOneConnectionPerTeam } from '@/dfe/controllers/org-connection';
import {
  repairTeamConnections,
  scheduleTeamConnectionRepair,
} from '@/dfe/tasks/team-connection-repair';
import { mongooseConnection } from '@/models';
import Alert from '@/models/alert';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Team from '@/models/team';
import User from '@/models/user';
import logger from '@/utils/logger';

const config = dfeConfig as Record<string, unknown>;
const conn = mongooseConnection as unknown as {
  readyState: number;
  once: jest.Mock;
};

// A group team seeded by an admin, an identity team, and an orphan.
const TEAMS = [
  { _id: 'team-group', name: 'acme-team' },
  { _id: 'team-org', name: 'dfe_org_acme' },
  { _id: 'team-platform', name: 'dfe_query_reader' },
];
const CONNECTIONS = [
  { _id: 'conn-leak', team: 'team-group', username: 'dfe_query_reader' },
  { _id: 'conn-org', team: 'team-org', username: 'dfe_org_acme' },
  { _id: 'conn-platform', team: 'team-platform', username: 'dfe_query_reader' },
  { _id: 'conn-orphan', team: 'team-gone', username: 'dfe_org_nerk' },
];

beforeEach(() => {
  jest.clearAllMocks();
  config.DFE_AUTH_MODE = 'oidc-proxy';
  conn.readyState = 0;
  (Team.find as jest.Mock).mockReturnValue(lean(TEAMS));
  (Connection.find as jest.Mock).mockReturnValue(lean(CONNECTIONS));
  (User.countDocuments as jest.Mock).mockResolvedValue(3);
  (Source.countDocuments as jest.Mock).mockResolvedValue(6);
  (SavedSearch.countDocuments as jest.Mock).mockResolvedValue(2);
  (Dashboard.countDocuments as jest.Mock).mockResolvedValue(4);
  (Alert.countDocuments as jest.Mock).mockResolvedValue(0);
});

describe('repairTeamConnections', () => {
  test('deletes every connection that is not its team identity and keeps the rest', async () => {
    const report = await repairTeamConnections();

    const deleted = (Connection.deleteOne as jest.Mock).mock.calls.map(
      call => call[0]._id,
    );
    expect(deleted.sort()).toEqual(['conn-leak', 'conn-orphan']);
    expect(report).toEqual({ checked: 4, deleted: 2 });
  });

  test('never reads the connection password', async () => {
    await repairTeamConnections();

    const projection = (Connection.find as jest.Mock).mock.calls[0]?.[1];
    expect(projection).toBe('team username');
    expect(projection).not.toContain('password');
  });

  test('logs the team, username and member count for each deletion', async () => {
    await repairTeamConnections();

    expect(logger.warn).toHaveBeenCalledWith(
      {
        teamId: 'team-group',
        team: 'acme-team',
        username: 'dfe_query_reader',
        connectionId: 'conn-leak',
        members: 3,
      },
      'DFE: deleting a team connection that is not the team identity',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-gone',
        team: null,
        username: 'dfe_org_nerk',
      }),
      'DFE: deleting a team connection that is not the team identity',
    );
    expect(User.countDocuments).toHaveBeenCalledWith({ team: 'team-group' });
  });

  test('logs what each emptied team still holds, and touches none of it', async () => {
    await repairTeamConnections();

    expect(logger.info).toHaveBeenCalledWith(
      {
        teamId: 'team-group',
        team: 'acme-team',
        sources: 6,
        savedSearches: 2,
        dashboards: 4,
        alerts: 0,
      },
      'DFE: team left without a connection keeps its content',
    );
    // The orphan has no team to report on; the kept teams were not emptied.
    const emptied = (logger.info as jest.Mock).mock.calls
      .filter(
        call =>
          call[1] === 'DFE: team left without a connection keeps its content',
      )
      .map(call => call[0].teamId);
    expect(emptied).toEqual(['team-group']);
  });

  test('ensures one connection per team once the sweep is done', async () => {
    await repairTeamConnections();

    expect(ensureOneConnectionPerTeam).toHaveBeenCalledTimes(1);
    expect(
      (ensureOneConnectionPerTeam as jest.Mock).mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      Math.max(...(Connection.deleteOne as jest.Mock).mock.invocationCallOrder),
    );
  });

  test('deletes nothing when every team holds its own identity', async () => {
    (Connection.find as jest.Mock).mockReturnValue(
      lean(
        CONNECTIONS.filter(
          c => c._id === 'conn-org' || c._id === 'conn-platform',
        ),
      ),
    );

    await expect(repairTeamConnections()).resolves.toEqual({
      checked: 2,
      deleted: 0,
    });
    expect(Connection.deleteOne).not.toHaveBeenCalled();
  });
});

describe('scheduleTeamConnectionRepair', () => {
  test('waits for Mongo to connect', () => {
    scheduleTeamConnectionRepair();

    expect(conn.once).toHaveBeenCalledWith('connected', expect.any(Function));
    expect(Team.find).not.toHaveBeenCalled();
  });

  test('runs at once when Mongo is already connected', async () => {
    conn.readyState = 1;

    scheduleTeamConnectionRepair();
    await new Promise(resolve => setImmediate(resolve));

    expect(Team.find).toHaveBeenCalledTimes(1);
    expect(conn.once).not.toHaveBeenCalled();
  });

  test.each(['header-dev', undefined])(
    'never runs in %s mode, where teams hold DEFAULT_CONNECTIONS',
    mode => {
      config.DFE_AUTH_MODE = mode;
      conn.readyState = 1;

      scheduleTeamConnectionRepair();

      expect(Team.find).not.toHaveBeenCalled();
      expect(conn.once).not.toHaveBeenCalled();
    },
  );

  test('a failed repair is logged, never thrown', async () => {
    conn.readyState = 1;
    (Team.find as jest.Mock).mockReturnValue({
      lean: jest.fn(async () => {
        throw new Error('mongo down');
      }),
    });

    scheduleTeamConnectionRepair();
    await new Promise(resolve => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'DFE: team connection repair failed',
    );
  });
});
