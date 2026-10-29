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

import express from 'express';
import request from 'supertest';

import sessionRoleRouter from '@/dfe/routers/session-role';

function appWithRole() {
  const app = express();
  app.use((req, _res, next) => {
    req.dfeRole = req.header('x-test-role');
    next();
  });
  app.use('/dfe', sessionRoleRouter);
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
