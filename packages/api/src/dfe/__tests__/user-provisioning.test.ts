/**
 * DFE user provisioning race-safety.
 *
 * First login fires several requests at once (the iframe loads team + sources +
 * connections together), so find-or-create must survive two concurrent inserts
 * colliding on the unique `email_1` index: the loser catches the duplicate-key
 * and returns the winner instead of surfacing a 500.
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

const save = jest.fn();

jest.mock('@/models/user', () => {
  const User = jest.fn().mockImplementation((doc: Record<string, unknown>) => ({
    ...doc,
    _id: 'new-user',
    save,
  }));
  (User as unknown as { findOne: jest.Mock }).findOne = jest.fn();
  return { __esModule: true, default: User };
});

import { findOrCreateUserFromOIDC } from '@/dfe/controllers/user-provisioning';
import User from '@/models/user';

const mockFindOne = (User as unknown as { findOne: jest.Mock }).findOne;
const TEAM = 'team-1' as unknown as Parameters<
  typeof findOrCreateUserFromOIDC
>[1];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findOrCreateUserFromOIDC', () => {
  test('returns the existing user without creating', async () => {
    mockFindOne.mockResolvedValueOnce({ _id: 'u1', email: 'a@b.com' });

    const { user, created } = await findOrCreateUserFromOIDC('A@B.com', TEAM);

    expect(created).toBe(false);
    expect(user).toEqual({ _id: 'u1', email: 'a@b.com' });
    expect(save).not.toHaveBeenCalled();
  });

  test('matches on email ALONE, not team (email is the unique index)', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    save.mockResolvedValueOnce(undefined);

    await findOrCreateUserFromOIDC('New@B.com', TEAM);

    expect(mockFindOne).toHaveBeenCalledWith({ email: 'new@b.com' });
  });

  test('creates a lowercased user when none exists', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    save.mockResolvedValueOnce(undefined);

    const { user, created } = await findOrCreateUserFromOIDC('New@B.com', TEAM);

    expect(created).toBe(true);
    expect(user).toMatchObject({ email: 'new@b.com', team: TEAM });
  });

  test('resolves a concurrent-insert duplicate key by returning the winner', async () => {
    // First find misses, save collides on email_1, second find returns the winner.
    mockFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'winner', email: 'race@b.com' });
    save.mockRejectedValueOnce({ code: 11000 });

    const { user, created } = await findOrCreateUserFromOIDC(
      'race@b.com',
      TEAM,
    );

    expect(created).toBe(false);
    expect(user).toEqual({ _id: 'winner', email: 'race@b.com' });
    expect(mockFindOne).toHaveBeenCalledTimes(2);
  });

  test('rethrows a non-duplicate save error', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    save.mockRejectedValueOnce(new Error('db down'));

    await expect(findOrCreateUserFromOIDC('x@b.com', TEAM)).rejects.toThrow(
      'db down',
    );
  });
});
