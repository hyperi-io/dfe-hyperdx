/**
 * GET /dfe/session tells the page which role the session holds, so it can leave
 * out the actions a read-only session is refused. Driven through express with the
 * role on a header, standing in for the identity middleware.
 */

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  get isDfeEnabled() {
    return mockDfeEnabled;
  },
}));

let mockDfeEnabled = true;

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@/middleware/auth', () => ({
  __esModule: true,
  getNonNullUserWithTeam: jest.fn(),
}));

jest.mock('@/dfe/models/dashboard-tombstone', () => ({
  __esModule: true,
  clearDashboardTombstones: jest.fn(),
}));

jest.mock('@/tasks/provisionDashboards', () => ({
  __esModule: true,
  syncDashboards: jest.fn(),
}));

import express from 'express';
import request from 'supertest';

// The route is reached the way api-app.ts reaches it: through this router.
import shippedDashboardsRouter from '@/dfe/routers/shipped-dashboards';

function appWithRole() {
  const app = express();
  app.use((req, _res, next) => {
    req.dfeRole = req.header('x-test-role');
    next();
  });
  app.use('/dfe', shippedDashboardsRouter);
  return app;
}

const app = appWithRole();

describe('GET /dfe/session', () => {
  beforeEach(() => {
    mockDfeEnabled = true;
  });

  it.each([
    ['viewer', 'viewer', true],
    ['VIEWER', 'VIEWER', true],
    ['member', 'member', false],
    ['admin', 'admin', false],
    ['owner', 'owner', false],
  ])(
    'role %s is reported as %s, read-only %s',
    async (sent, role, readOnly) => {
      const res = await request(app)
        .get('/dfe/session')
        .set('x-test-role', sent);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ role, readOnly });
    },
  );

  it('reports no role, and not read-only, for a session the engine gave none', async () => {
    const res = await request(app).get('/dfe/session');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ role: null, readOnly: false });
  });

  it('is not there outside DFE mode', async () => {
    mockDfeEnabled = false;

    const res = await request(app)
      .get('/dfe/session')
      .set('x-test-role', 'viewer');

    expect(res.status).toBe(404);
  });
});
