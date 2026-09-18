/**
 * DFE admin-surface lockdown: admin surfaces are engine-only in DFE mode.
 *
 * The no-op-when-DFE-off branch is exercised implicitly by the rest of the suite
 * (which runs with DFE auth unset and must be unaffected); here DFE mode is on so
 * the enforcing behaviour is asserted directly.
 */
jest.mock('@/dfe/config', () => ({
  __esModule: true,
  get isDfeEnabled() {
    return mockDfeEnabled;
  },
}));

let mockDfeEnabled = true;

import { makeRequest, makeResponse as res } from '@/dfe/__tests__/doubles';
import {
  allowReadElseServicePrincipal,
  allowTeamReadElseServicePrincipal,
  blockClickhouseProxyTest,
  requireDfeMode,
  requireServicePrincipal,
} from '@/dfe/middleware/admin-lockdown';

beforeEach(() => {
  mockDfeEnabled = true;
});

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

const TEAM_RECORD = {
  _id: '507f1f77bcf86cd799439099',
  name: 'acme',
  apiKey: 'hdx-secret',
  allowedAuthMethods: ['password'],
  isMetricsSeriesTableEnabled: true,
};

describe('allowTeamReadElseServicePrincipal (DFE mode on)', () => {
  test('a member reads the team record without the admin-only fields', () => {
    const r = res();
    const sent = jest.mocked(r.json);
    const next = jest.fn();

    allowTeamReadElseServicePrincipal(
      makeRequest({ method: 'GET', path: '/', dfeIsServicePrincipal: false }),
      r,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();

    r.json(TEAM_RECORD);

    expect(sent).toHaveBeenCalledWith({
      _id: '507f1f77bcf86cd799439099',
      name: 'acme',
      isMetricsSeriesTableEnabled: true,
    });
  });

  test('403s a member WRITE', () => {
    const r = res();
    const next = jest.fn();
    allowTeamReadElseServicePrincipal(
      makeRequest({ method: 'PUT', path: '/', dfeIsServicePrincipal: false }),
      r,
      next,
    );
    expect(r.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test.each(['/members', '/invitations', '/apiKey', '/tags'])(
    '403s a member read of %s',
    path => {
      const r = res();
      const next = jest.fn();
      allowTeamReadElseServicePrincipal(
        makeRequest({ method: 'GET', path, dfeIsServicePrincipal: false }),
        r,
        next,
      );
      expect(r.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    },
  );

  test('the service principal reads the record whole', () => {
    const r = res();
    const sent = jest.mocked(r.json);
    const next = jest.fn();

    allowTeamReadElseServicePrincipal(
      makeRequest({ method: 'GET', path: '/', dfeIsServicePrincipal: true }),
      r,
      next,
    );
    r.json(TEAM_RECORD);

    expect(next).toHaveBeenCalled();
    expect(sent).toHaveBeenCalledWith(TEAM_RECORD);
  });

  test('outside DFE mode the record is untouched', () => {
    mockDfeEnabled = false;
    const r = res();
    const sent = jest.mocked(r.json);
    const next = jest.fn();

    allowTeamReadElseServicePrincipal(
      makeRequest({ method: 'PUT', path: '/', dfeIsServicePrincipal: false }),
      r,
      next,
    );
    r.json(TEAM_RECORD);

    expect(next).toHaveBeenCalled();
    expect(sent).toHaveBeenCalledWith(TEAM_RECORD);
  });
});

describe('requireDfeMode', () => {
  test('passes the request through in DFE mode', () => {
    const next = jest.fn();
    requireDfeMode(makeRequest(), res(), next);
    expect(next).toHaveBeenCalledWith();
  });

  test('leaves the router entirely when DFE mode is off', () => {
    mockDfeEnabled = false;
    const next = jest.fn();
    requireDfeMode(makeRequest(), res(), next);
    expect(next).toHaveBeenCalledWith('router');
  });
});
