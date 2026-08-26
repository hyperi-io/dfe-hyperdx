/**
 * Status mapping on POST /dfe/create-rule.
 *
 * The invariant: this route never answers 401. The app redirects to /login on
 * any 401 from `hdxServer`, so an engine-credential failure would log the
 * analyst out of HyperDX and discard the search they had just built. Every
 * other engine status, 403 above all, is forwarded verbatim.
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

jest.mock('@/controllers/connection', () => ({ getConnectionById: jest.fn() }));
jest.mock('@/controllers/sources', () => ({ getSource: jest.fn() }));
jest.mock('@/middleware/auth', () => ({ getNonNullUserWithTeam: jest.fn() }));

jest.mock('@/dfe/controllers/org-connection', () => ({
  engineOrigin: jest.fn(() => 'http://engine.test:8000'),
}));

jest.mock('@/dfe/middleware/jwt-verify', () => ({ extractToken: jest.fn() }));

import express from 'express';
import request from 'supertest';

import { extractToken } from '@/dfe/middleware/jwt-verify';
import router from '@/dfe/routers/query-export';

const mockExtractToken = jest.mocked(extractToken);

const app = express();
app.use(express.json());
app.use('/dfe', router);

const RULE_BODY = { rawSql: 'SELECT 1', savedSearchName: 'noisy logins' };

/** An engine reply with the given status and a JSON body. */
function engineReplies(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExtractToken.mockReturnValue('engine-token');
});

describe('POST /dfe/create-rule status mapping', () => {
  it('answers 502, not 401, when the session carries no engine token', async () => {
    mockExtractToken.mockReturnValue(undefined);

    const res = await request(app).post('/dfe/create-rule').send(RULE_BODY);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/engine credential/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('turns an engine 401 into a 502 that keeps the engine status', async () => {
    engineReplies(401, { detail: 'token expired' });

    const res = await request(app).post('/dfe/create-rule').send(RULE_BODY);

    expect(res.status).toBe(502);
    expect(res.body.engineStatus).toBe(401);
  });

  it('forwards a 403 verbatim so the permission message still fires', async () => {
    engineReplies(403, { detail: 'rule:write required' });

    const res = await request(app).post('/dfe/create-rule').send(RULE_BODY);

    expect(res.status).toBe(403);
    expect(res.body.detail).toBe('rule:write required');
  });

  it('forwards the created rule on success', async () => {
    engineReplies(200, { id: 'rule-1', display_name: 'noisy logins' });

    const res = await request(app).post('/dfe/create-rule').send(RULE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('rule-1');
  });

  it('sends the expanded SQL to the engine as raw_sql', async () => {
    engineReplies(200, { id: 'rule-1', display_name: 'noisy logins' });

    await request(app).post('/dfe/create-rule').send(RULE_BODY);

    const [, init] = jest.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      raw_sql: 'SELECT 1',
      saved_search_name: 'noisy logins',
    });
  });
});
