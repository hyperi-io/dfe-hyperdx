/**
 * DFE team provisioning race-safety.
 *
 * First login fires several requests at once, so find-or-create must survive two
 * concurrent inserts colliding on the unique `name` index: the loser catches the
 * duplicate-key and returns the winner so all requests land on ONE team.
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

// oidc-proxy mode: setupTeamDefaults is skipped (the engine seeds per team).
jest.mock('@/dfe/config', () => ({ DFE_AUTH_MODE: 'oidc-proxy' }));

const setupTeamDefaults = jest.fn();
jest.mock('@/setupDefaults', () => ({ setupTeamDefaults }));

const save = jest.fn();

jest.mock('@/models/team', () => {
  const Team = jest.fn().mockImplementation((doc: Record<string, unknown>) => ({
    ...doc,
    _id: { toString: () => 'new-team' },
    save,
  }));
  (Team as unknown as { findOne: jest.Mock }).findOne = jest.fn();
  (Team as unknown as { collection: { createIndex: jest.Mock } }).collection = {
    createIndex: jest.fn().mockResolvedValue(undefined),
  };
  return { __esModule: true, default: Team };
});

import { findOrCreateTeamByName } from '@/dfe/controllers/team-provisioning';
import Team from '@/models/team';

const mockFindOne = (Team as unknown as { findOne: jest.Mock }).findOne;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findOrCreateTeamByName', () => {
  test('returns the existing team without creating', async () => {
    mockFindOne.mockResolvedValueOnce({ _id: 't1', name: 'acme' });

    const { team, created } = await findOrCreateTeamByName('acme');

    expect(created).toBe(false);
    expect(team).toEqual({ _id: 't1', name: 'acme' });
    expect(save).not.toHaveBeenCalled();
  });

  test('creates the team when none exists', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    save.mockResolvedValueOnce(undefined);

    const { team, created } = await findOrCreateTeamByName('acme');

    expect(created).toBe(true);
    expect(team).toMatchObject({ name: 'acme' });
  });

  test('resolves a concurrent-insert duplicate key by returning the winner', async () => {
    mockFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'winner', name: 'acme' });
    save.mockRejectedValueOnce({ code: 11000 });

    const { team, created } = await findOrCreateTeamByName('acme');

    expect(created).toBe(false);
    expect(team).toEqual({ _id: 'winner', name: 'acme' });
    expect(mockFindOne).toHaveBeenCalledTimes(2);
  });

  test('rethrows a non-duplicate save error', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    save.mockRejectedValueOnce(new Error('db down'));

    await expect(findOrCreateTeamByName('acme')).rejects.toThrow('db down');
  });
});
