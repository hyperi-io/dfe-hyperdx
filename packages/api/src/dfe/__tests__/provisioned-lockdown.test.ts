/**
 * DFE provisioned-dashboard lockdown.
 *
 * The invariant: a dashboard the provisioner owns cannot be written through the
 * API, because the one-minute reconcile would revert the edit silently. Reads and
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
  default: { exists: jest.fn() },
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
import Dashboard from '@/models/dashboard';

const mockExists = Dashboard.exists as unknown as jest.Mock;

function call(method: string, path: string) {
  const req = { method, path } as Request;
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })) } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next, json };
}

const PROVISIONED = '/507f1f77bcf86cd799439011';

beforeEach(() => {
  jest.clearAllMocks();
  mockDfeEnabled = true;
});

describe('blockProvisionedWrites', () => {
  test.each(['PATCH', 'DELETE', 'PUT'])(
    '%s against a provisioned dashboard is refused',
    async method => {
      mockExists.mockResolvedValue({ _id: 'x' });
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
    mockExists.mockResolvedValue(null);
    const { req, res, next } = call('PATCH', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(mockExists).toHaveBeenCalledWith({
      _id: '507f1f77bcf86cd799439011',
      provisioned: true,
    });
    expect(next).toHaveBeenCalled();
  });

  test('a user-owned dashboard is passed through', async () => {
    mockExists.mockResolvedValue(null);
    const { req, res, next } = call('PATCH', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test.each(['GET', 'HEAD', 'OPTIONS'])(
    '%s is never blocked, even on a provisioned dashboard',
    async method => {
      mockExists.mockResolvedValue({ _id: 'x' });
      const { req, res, next } = call(method, PROVISIONED);

      await blockProvisionedWrites(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockExists).not.toHaveBeenCalled();
    },
  );

  test('a create (no id in the path) is allowed', async () => {
    const { req, res, next } = call('POST', '/');

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockExists).not.toHaveBeenCalled();
  });

  test('outside DFE mode the guard is inert', async () => {
    mockDfeEnabled = false;
    mockExists.mockResolvedValue({ _id: 'x' });
    const { req, res, next } = call('DELETE', PROVISIONED);

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockExists).not.toHaveBeenCalled();
  });

  test('a lookup failure falls through rather than 500ing the request', async () => {
    mockExists.mockRejectedValue(new Error('bad ObjectId'));
    const { req, res, next } = call('PATCH', '/not-an-object-id');

    await blockProvisionedWrites(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
