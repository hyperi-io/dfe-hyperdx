/**
 * The engine's `viewer` role is read-only: every write it sends is refused
 * except a query, the caller's own favourites and profile, and the rule export
 * the engine authorises itself. Driven through express so the paths match the
 * way express routes them.
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

import {
  READ_ONLY_FORBIDDEN,
  refuseReadOnlyWrites,
} from '@/dfe/middleware/role-claim';

// Stands in for the identity middleware: the role arrives on a header.
function appWithRole() {
  const app = express();
  app.use((req, _res, next) => {
    req.dfeRole = req.header('x-test-role');
    next();
  });
  app.use(refuseReadOnlyWrites);
  app.use((_req, res) => {
    res.status(200).json({ reached: true });
  });
  return app;
}

const app = appWithRole();

type Method = 'post' | 'put' | 'patch' | 'delete';

const send = (method: Method, path: string, role?: string) => {
  const req = request(app)[method](path);
  return role === undefined ? req : req.set('x-test-role', role);
};

// Every human-reachable write in packages/api/src/routers/api and dfe/routers.
const WRITES: ReadonlyArray<[Method, string]> = [
  ['post', '/saved-search'],
  ['patch', '/saved-search/507f1f77bcf86cd799439011'],
  ['delete', '/saved-search/507f1f77bcf86cd799439011'],
  ['post', '/dashboards'],
  ['patch', '/dashboards/507f1f77bcf86cd799439011'],
  ['delete', '/dashboards/507f1f77bcf86cd799439011'],
  ['put', '/dashboards/preset/services/filter'],
  ['post', '/dashboards/preset/services/filter'],
  ['delete', '/dashboards/preset/services/filter/507f1f77bcf86cd799439011'],
  ['put', '/pinned-filters'],
  ['post', '/alerts'],
  ['put', '/alerts/507f1f77bcf86cd799439011'],
  ['delete', '/alerts/507f1f77bcf86cd799439011'],
  ['post', '/alerts/507f1f77bcf86cd799439011/silenced'],
  ['delete', '/alerts/507f1f77bcf86cd799439011/silenced'],
  ['post', '/webhooks'],
  ['put', '/webhooks/507f1f77bcf86cd799439011'],
  ['delete', '/webhooks/507f1f77bcf86cd799439011'],
  ['post', '/webhooks/test'],
  ['post', '/connections'],
  ['put', '/connections/507f1f77bcf86cd799439011'],
  ['delete', '/connections/507f1f77bcf86cd799439011'],
  ['post', '/sources'],
  ['put', '/sources/507f1f77bcf86cd799439011'],
  ['delete', '/sources/507f1f77bcf86cd799439011'],
  ['patch', '/team/apiKey'],
  ['patch', '/team/name'],
  ['patch', '/team/clickhouse-settings'],
  ['post', '/team/invitation'],
  ['delete', '/team/invitation/507f1f77bcf86cd799439011'],
  ['delete', '/team/member/507f1f77bcf86cd799439011'],
  ['post', '/dfe/dashboards/restore-shipped'],
  ['put', '/dfe/sources/main'],
  ['delete', '/dfe/sources/main'],
];

// The writes a read-only session keeps.
const KEPT: ReadonlyArray<[Method, string]> = [
  ['post', '/clickhouse-proxy/'],
  ['post', '/clickhouse-proxy/?default_format=JSONCompact'],
  ['post', '/v1/prometheus/query_range'],
  ['post', '/ai/assistant'],
  ['post', '/dfe/export-sql'],
  ['post', '/dfe/create-rule'],
  ['put', '/favorites'],
  ['delete', '/favorites/dashboard/507f1f77bcf86cd799439011'],
  ['post', '/me/onboarding/task'],
];

describe('refuseReadOnlyWrites', () => {
  beforeEach(() => {
    mockDfeEnabled = true;
  });

  it.each(WRITES)('refuses a viewer %s %s', async (method, path) => {
    const res = await send(method, path, 'viewer');

    expect(res.status).toBe(403);
    expect(res.body).toEqual(READ_ONLY_FORBIDDEN);
  });

  it.each(KEPT)('lets a viewer %s %s', async (method, path) => {
    const res = await send(method, path, 'viewer');

    expect(res.status).toBe(200);
  });

  it.each(['member', 'admin', 'owner'])('lets a %s write', async role => {
    const res = await send('post', '/saved-search', role);

    expect(res.status).toBe(200);
  });

  it('lets a session with no role write, as before', async () => {
    const res = await send('post', '/saved-search');

    expect(res.status).toBe(200);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('lets a viewer %s', async method => {
    const res = await request(app)
      [method.toLowerCase() as 'get' | 'head' | 'options']('/saved-search')
      .set('x-test-role', 'viewer');

    expect(res.status).toBe(200);
  });

  it('matches the role and the path regardless of case', async () => {
    const upper = await send('post', '/saved-search', 'VIEWER');
    const mixed = await send('post', '/Saved-Search', 'viewer');

    expect(upper.status).toBe(403);
    expect(mixed.status).toBe(403);
  });

  it.each([
    '/saved-search/',
    '//saved-search',
    '/mex',
    '/me-too',
    '/clickhouse-proxyx',
    '/favoritesx',
    '/dfe/export-sql-all',
    '/ai/assistant/extra',
    '/v1/prometheus',
  ])('refuses a viewer POST to the lookalike %s', async path => {
    const res = await send('post', path, 'viewer');

    expect(res.status).toBe(403);
  });

  it('is inert outside DFE mode', async () => {
    mockDfeEnabled = false;

    const res = await send('post', '/saved-search', 'viewer');

    expect(res.status).toBe(200);
  });
});
