/**
 * DFE admin-surface lockdown: admin surfaces are engine-only in DFE mode.
 *
 * The no-op-when-DFE-off branch is exercised implicitly by the rest of the suite
 * (which runs with DFE auth unset and must be unaffected); here DFE mode is on so
 * the enforcing behaviour is asserted directly.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Building minimal express Request/Response doubles asserts narrower types than
 * the real ones; scoped here rather than relaxed in upstream's eslint config.
 */
import type { Request, Response } from 'express';

jest.mock('@/dfe/config', () => ({ isDfeEnabled: true }));

import {
  blockClickhouseProxyTest,
  requireServicePrincipal,
} from '@/dfe/middleware/admin-lockdown';

function res(): Response {
  const r: Partial<Response> = {};
  r.status = jest.fn(() => r as Response);
  r.json = jest.fn(() => r as Response);
  return r as Response;
}

describe('requireServicePrincipal (DFE mode on)', () => {
  test('403s a non-service principal', () => {
    const r = res();
    const next = jest.fn();
    requireServicePrincipal(
      { dfeIsServicePrincipal: false } as Request,
      r,
      next,
    );
    expect(r.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('passes the engine service principal', () => {
    const r = res();
    const next = jest.fn();
    requireServicePrincipal(
      { dfeIsServicePrincipal: true } as Request,
      r,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();
  });
});

describe('blockClickhouseProxyTest (DFE mode on)', () => {
  test('403s POST /test for a non-service principal', () => {
    const r = res();
    const next = jest.fn();
    blockClickhouseProxyTest(
      { path: '/test', dfeIsServicePrincipal: false } as Request,
      r,
      next,
    );
    expect(r.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('lets a normal query path through', () => {
    const r = res();
    const next = jest.fn();
    blockClickhouseProxyTest(
      { path: '/', dfeIsServicePrincipal: false } as Request,
      r,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();
  });

  test('lets the service principal test a connection', () => {
    const r = res();
    const next = jest.fn();
    blockClickhouseProxyTest(
      { path: '/test', dfeIsServicePrincipal: true } as Request,
      r,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});
