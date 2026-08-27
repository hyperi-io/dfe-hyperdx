/**
 * DFE admin-surface lockdown: admin surfaces are engine-only in DFE mode.
 *
 * The no-op-when-DFE-off branch is exercised implicitly by the rest of the suite
 * (which runs with DFE auth unset and must be unaffected); here DFE mode is on so
 * the enforcing behaviour is asserted directly.
 */
jest.mock('@/dfe/config', () => ({ isDfeEnabled: true }));

import { makeRequest, makeResponse as res } from '@/dfe/__tests__/doubles';
import {
  allowReadElseServicePrincipal,
  blockClickhouseProxyTest,
  requireServicePrincipal,
} from '@/dfe/middleware/admin-lockdown';

describe('requireServicePrincipal (DFE mode on)', () => {
  test('403s a non-service principal', () => {
    const r = res();
    const next = jest.fn();
    requireServicePrincipal(
      makeRequest({ dfeIsServicePrincipal: false }),
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
      makeRequest({ dfeIsServicePrincipal: true }),
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
      makeRequest({ path: '/test', dfeIsServicePrincipal: false }),
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
      makeRequest({ path: '/', dfeIsServicePrincipal: false }),
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
      makeRequest({ path: '/test', dfeIsServicePrincipal: true }),
      r,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('allowReadElseServicePrincipal (DFE mode on)', () => {
  test('lets a human GET through (read is team-scoped downstream)', () => {
    const r = res();
    const next = jest.fn();
    allowReadElseServicePrincipal(
      makeRequest({ method: 'GET', dfeIsServicePrincipal: false }),
      r,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();
  });

  test('403s a human WRITE', () => {
    const r = res();
    const next = jest.fn();
    allowReadElseServicePrincipal(
      makeRequest({ method: 'POST', dfeIsServicePrincipal: false }),
      r,
      next,
    );
    expect(r.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('lets the service principal WRITE', () => {
    const r = res();
    const next = jest.fn();
    allowReadElseServicePrincipal(
      makeRequest({ method: 'POST', dfeIsServicePrincipal: true }),
      r,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});
