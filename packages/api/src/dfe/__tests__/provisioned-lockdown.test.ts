/**
 * DFE provisioned-dashboard lockdown.
 *
 * The invariant: a dashboard the provisioner owns cannot be MODIFIED through the
 * API, because the one-minute reconcile would revert the edit silently. Deleting
 * one is allowed and tombstoned, so the provisioner leaves it deleted. Reads and
 * user-owned dashboards are untouched, and the guard is inert outside DFE mode so
 * upstream behaviour is unchanged.
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

jest.mock('@/models/dashboard', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('@/dfe/models/dashboard-tombstone', () => ({
  __esModule: true,
  recordDashboardTombstone: jest.fn().mockResolvedValue(true),
  removeDashboardTombstone: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  get isDfeEnabled() {
    return mockDfeEnabled;
  },
}));

let mockDfeEnabled = true;

import type { NextFunction, Request, Response } from 'express';

import { blockProvisionedWrites } from '@/dfe/middleware/provisioned-lockdown';
import {
  recordDashboardTombstone,
  removeDashboardTombstone,
} from '@/dfe/models/dashboard-tombstone';
import Dashboard from '@/models/dashboard';

const mockFindOne = Dashboard.findOne as unknown as jest.Mock;
const mockRecordTombstone = recordDashboardTombstone as jest.Mock;
const mockRemoveTombstone = removeDashboardTombstone as jest.Mock;

/** What the middleware sees for a provisioned dashboard, or null for a user one. */
function findsProvisioned(doc: { name: string; team: string } | null) {
  mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
}

/** A findOne that answers as Mongo does: a filter naming a team matches only that team's dashboard. */
function storeHolds(doc: { name: string; team: string }) {
  mockFindOne.mockImplementation((filter: { team?: unknown }) => ({
    lean: jest
      .fn()
      .mockResolvedValue(
        filter.team === undefined || String(filter.team) === doc.team
          ? doc
          : null,
      ),
  }));
}

function call(
  method: string,
  path: string,
  dfeRole?: string,
  team: string | null = CALLER_TEAM,
) {
  const user = team === null ? {} : { team };
  const req = { method, path, dfeRole, user } as unknown as Request;
  const json = jest.fn();
  const listeners = new Map<string, () => void>();
  const res = {
    statusCode: 200,
    status: jest.fn(function (this: Response, code: number) {
      (this as unknown as { statusCode: number }).statusCode = code;
      return { json };
    }),
    on: jest.fn((event: string, handler: () => void) => {
      listeners.set(event, handler);
    }),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  const finish = (statusCode = 204) => {
    (res as unknown as { statusCode: number }).statusCode = statusCode;
    listeners.get('finish')?.();
  };
  return { req, res, next, json, finish };
}

const PROVISIONED = '/507f1f77bcf86cd799439011';
const CALLER_TEAM = '507f1f77bcf86cd799439099';
const OTHER_TEAM = '507f1f77bcf86cd799439088';
const SHIPPED = { name: 'DFE Overview', team: CALLER_TEAM };
const OTHER_TEAMS_SHIPPED = { name: 'DFE Overview', team: OTHER_TEAM };

beforeEach(() => {
  jest.clearAllMocks();
  mockDfeEnabled = true;
  mockRecordTombstone.mockResolvedValue(true);
  mockRemoveTombstone.mockResolvedValue(undefined);
});

describe('blockProvisionedWrites', () => {
  test.each(['PATCH', 'PUT'])(
    '%s against a provisioned dashboard is refused',
    async method => {
      findsProvisioned(SHIPPED);
      const { req, res, next, json } = call(method, PROVISIONED);

      await blockProvisionedWrites(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Duplicate it'),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    },
  );

  test('the id is matched with provisioned: true in the caller team, never on id alone', async () => {
    findsProvisioned(null);
    const { req, res, next } = call('PATCH', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(mockFindOne).toHaveBeenCalledWith(
      {
        _id: '507f1f77bcf86cd799439011',
        provisioned: true,
        team: CALLER_TEAM,
      },
      'name team',
    );
    expect(next).toHaveBeenCalled();
  });

  test.each(['PATCH', 'DELETE'])(
    '%s on a percent-encoded id is looked up as the id the router will use',
    async method => {
      // Express decodes :id before the route runs, so '%31' reaches the
      // handler as '1'. Looking up the raw segment casts to nothing and the
      // lock never applies.
      findsProvisioned(SHIPPED);
      const { req, res, next } = call(method, '/507f1f77bcf86cd79943901%31');

      await blockProvisionedWrites(req, res, next);

      expect(mockFindOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: '507f1f77bcf86cd799439011' }),
        'name team',
      );
      if (method === 'PATCH') {
        expect(res.status).toHaveBeenCalledWith(403);
      }
    },
  );

  test('a malformed percent-encoding is left to the route to refuse', async () => {
    const { req, res, next } = call('PATCH', '/%E0%A4%A');

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test('a user-owned dashboard is passed through', async () => {
    findsProvisioned(null);
    const { req, res, next } = call('PATCH', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test.each(['GET', 'HEAD', 'OPTIONS'])(
    '%s is never blocked, even on a provisioned dashboard',
    async method => {
      findsProvisioned(SHIPPED);
      const { req, res, next } = call(method, PROVISIONED);

      await blockProvisionedWrites(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockFindOne).not.toHaveBeenCalled();
    },
  );

  test('a create (no id in the path) is allowed', async () => {
    const { req, res, next } = call('POST', '/');

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test('outside DFE mode the guard is inert', async () => {
    mockDfeEnabled = false;
    findsProvisioned(SHIPPED);
    const { req, res, next } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test.each(['PATCH', 'DELETE'])(
    '%s on an id that is no ObjectId is left to the route, which answers 400',
    async method => {
      const { req, res, next } = call(method, '/not-an-object-id');

      await blockProvisionedWrites(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockFindOne).not.toHaveBeenCalled();
    },
  );

  test.each(['PATCH', 'PUT', 'DELETE'])(
    '%s is refused when the store cannot say whether the dashboard is shipped',
    async method => {
      mockFindOne.mockReturnValue({
        lean: jest.fn().mockRejectedValue(new Error('documentdb down')),
      });
      const { req, res, next, json } = call(method, PROVISIONED);

      await blockProvisionedWrites(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
      expect(next).not.toHaveBeenCalled();
      expect(mockRecordTombstone).not.toHaveBeenCalled();
    },
  );
});

describe('blockProvisionedWrites - delete and tombstone', () => {
  test('DELETE against a provisioned dashboard is allowed through', async () => {
    findsProvisioned(SHIPPED);
    const { req, res, next } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('the tombstone is durable before the delete runs, so the answer never precedes it', async () => {
    findsProvisioned(SHIPPED);
    let settle = (_created: boolean) => {};
    mockRecordTombstone.mockReturnValue(
      new Promise(resolve => {
        settle = resolve;
      }),
    );
    const { req, res, next } = call('DELETE', PROVISIONED);

    const pending = blockProvisionedWrites(req, res, next);
    await new Promise(resolve => setImmediate(resolve));
    expect(mockRecordTombstone).toHaveBeenCalledWith(
      'DFE Overview',
      '507f1f77bcf86cd799439099',
    );
    expect(next).not.toHaveBeenCalled();

    settle(true);
    await pending;
    expect(next).toHaveBeenCalled();
  });

  test('a tombstone that cannot be written refuses the delete', async () => {
    findsProvisioned(SHIPPED);
    mockRecordTombstone.mockRejectedValue(new Error('documentdb down'));
    const { req, res, next } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  test('a failed delete removes the tombstone it wrote', async () => {
    findsProvisioned(SHIPPED);
    const { req, res, next, finish } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);
    finish(500);

    expect(mockRemoveTombstone).toHaveBeenCalledWith(
      'DFE Overview',
      '507f1f77bcf86cd799439099',
    );
  });

  test('a failed delete keeps a tombstone that was there before it', async () => {
    findsProvisioned(SHIPPED);
    mockRecordTombstone.mockResolvedValue(false);
    const { req, res, next, finish } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);
    finish(500);

    expect(mockRemoveTombstone).not.toHaveBeenCalled();
  });

  test('a delete that succeeds keeps its tombstone', async () => {
    findsProvisioned(SHIPPED);
    const { req, res, next, finish } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);
    finish(204);

    expect(mockRemoveTombstone).not.toHaveBeenCalled();
  });

  test.each(['PATCH', 'PUT'])(
    "%s against another team's provisioned dashboard is answered as a missing one",
    async method => {
      storeHolds(OTHER_TEAMS_SHIPPED);
      const { req, res, next } = call(method, PROVISIONED);

      await blockProvisionedWrites(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  test("deleting another team's provisioned dashboard tombstones nothing", async () => {
    storeHolds(OTHER_TEAMS_SHIPPED);
    const { req, res, next, finish } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);
    finish(204);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(mockRecordTombstone).not.toHaveBeenCalled();
  });

  test('a session with no team is passed through without a lookup', async () => {
    storeHolds(SHIPPED);
    const { req, res, next } = call('DELETE', PROVISIONED, undefined, null);

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockRecordTombstone).not.toHaveBeenCalled();
  });

  test('deleting a user-owned dashboard tombstones nothing', async () => {
    findsProvisioned(null);
    const { req, res, next } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.on).not.toHaveBeenCalled();
    expect(mockRecordTombstone).not.toHaveBeenCalled();
  });
});

/**
 * The engine issues no role claim yet, so a token without one keeps the
 * team-membership rule. A deployment whose engine does issue one starts refusing
 * everybody below admin, with no change here.
 */
describe('blockProvisionedWrites - the role claim', () => {
  test.each(['admin', 'owner', 'ADMIN'])(
    '%s may delete a shipped dashboard',
    async role => {
      findsProvisioned(SHIPPED);
      const { req, res, next } = call('DELETE', PROVISIONED, role);

      await blockProvisionedWrites(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  test('a claim that is neither is refused', async () => {
    findsProvisioned(SHIPPED);
    const { req, res, next, json } = call('DELETE', PROVISIONED, 'viewer');

    await blockProvisionedWrites(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('admin or owner'),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('a refused delete tombstones nothing', async () => {
    findsProvisioned(SHIPPED);
    const { req, res, next } = call('DELETE', PROVISIONED, 'viewer');

    await blockProvisionedWrites(req, res, next);

    expect(res.on).not.toHaveBeenCalled();
    expect(mockRecordTombstone).not.toHaveBeenCalled();
  });
});
