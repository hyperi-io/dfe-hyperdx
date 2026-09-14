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
  recordDashboardTombstone: jest.fn().mockResolvedValue(undefined),
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
import { recordDashboardTombstone } from '@/dfe/models/dashboard-tombstone';
import Dashboard from '@/models/dashboard';

const mockFindOne = Dashboard.findOne as unknown as jest.Mock;
const mockRecordTombstone = recordDashboardTombstone as jest.Mock;

/** What the middleware sees for a provisioned dashboard, or null for a user one. */
function findsProvisioned(doc: { name: string; team: string } | null) {
  mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
}

function call(method: string, path: string, dfeRole?: string) {
  const req = { method, path, dfeRole } as Request;
  const json = jest.fn();
  const listeners: Record<string, () => void> = {};
  const res = {
    statusCode: 200,
    status: jest.fn(function (this: Response, code: number) {
      (this as unknown as { statusCode: number }).statusCode = code;
      return { json };
    }),
    on: jest.fn((event: string, handler: () => void) => {
      listeners[event] = handler;
    }),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  const finish = (statusCode = 204) => {
    (res as unknown as { statusCode: number }).statusCode = statusCode;
    listeners.finish?.();
  };
  return { req, res, next, json, finish };
}

const PROVISIONED = '/507f1f77bcf86cd799439011';
const SHIPPED = { name: 'DFE Overview', team: '507f1f77bcf86cd799439099' };

beforeEach(() => {
  jest.clearAllMocks();
  mockDfeEnabled = true;
  mockRecordTombstone.mockResolvedValue(undefined);
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

  test('the id is matched with provisioned: true, never on id alone', async () => {
    findsProvisioned(null);
    const { req, res, next } = call('PATCH', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(mockFindOne).toHaveBeenCalledWith(
      { _id: '507f1f77bcf86cd799439011', provisioned: true },
      'name team',
    );
    expect(next).toHaveBeenCalled();
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

  test('a lookup failure falls through rather than 500ing the request', async () => {
    mockFindOne.mockReturnValue({
      lean: jest.fn().mockRejectedValue(new Error('bad ObjectId')),
    });
    const { req, res, next } = call('PATCH', '/not-an-object-id');

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('blockProvisionedWrites - delete and tombstone', () => {
  test('DELETE against a provisioned dashboard is allowed through', async () => {
    findsProvisioned(SHIPPED);
    const { req, res, next } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('the tombstone is written once the delete has actually succeeded', async () => {
    findsProvisioned(SHIPPED);
    const { req, res, next, finish } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);
    expect(mockRecordTombstone).not.toHaveBeenCalled();

    finish(204);

    expect(mockRecordTombstone).toHaveBeenCalledWith(
      'DFE Overview',
      '507f1f77bcf86cd799439099',
    );
  });

  test('a failed delete leaves no tombstone behind', async () => {
    findsProvisioned(SHIPPED);
    const { req, res, next, finish } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);
    finish(500);

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
