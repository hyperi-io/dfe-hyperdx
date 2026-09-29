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

// The export path talks to ClickHouse to resolve column metadata. What the route
// hands the renderer is under test here, so the renderer is the capture point
// and everything under it is a stand-in.
jest.mock('@hyperdx/common-utils/dist/clickhouse/node', () => ({
  ClickhouseClient: jest.fn(() => ({})),
}));
jest.mock('@hyperdx/common-utils/dist/core/metadata', () => ({
  getMetadata: jest.fn(() => ({})),
}));
jest.mock('@hyperdx/common-utils/dist/core/renderChartConfig', () => ({
  renderChartConfig: jest.fn(async () => ({ sql: 'SELECT 1', params: {} })),
}));
jest.mock('@hyperdx/common-utils/dist/clickhouse', () => ({
  parameterizedQueryToSql: jest.fn(() => 'SELECT 1'),
}));
jest.mock('@hyperdx/common-utils/dist/sqlFormatter', () => ({
  format: jest.fn((sql: string) => sql),
}));

import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { makeDocument } from '@/dfe/__tests__/doubles';
import { extractToken } from '@/dfe/middleware/jwt-verify';
import router from '@/dfe/routers/query-export';
import { getNonNullUserWithTeam } from '@/middleware/auth';

const mockExtractToken = jest.mocked(extractToken);
const mockRender = jest.mocked(renderChartConfig);
const mockGetSource = jest.mocked(getSource);
const mockGetConnection = jest.mocked(getConnectionById);
const mockUserWithTeam = jest.mocked(getNonNullUserWithTeam);

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
    expect(JSON.parse(String(init?.body))).toMatchObject({
      raw_sql: 'SELECT 1',
      saved_search_name: 'noisy logins',
    });
  });
});

/**
 * What POST /dfe/export-sql renders.
 *
 * The engine builds a hunt rule from this SQL and scans the table its FROM
 * names, so the view's own table, search and filters have to reach the renderer
 * as the view runs them. The engine expands no placeholder: a templated table
 * or time condition is SQL it refuses.
 */
describe('POST /dfe/export-sql renders the view as it runs', () => {
  const FILTERS = [
    {
      type: 'sql' as const,
      condition: "toString(_json.user_name) IN ('root')",
    },
  ];
  const CHART_CONFIG = {
    source: '507f1f77bcf86cd799439011',
    select: '_timestamp,_json',
    where: 'rulecycle',
    whereLanguage: 'lucene' as const,
    filters: FILTERS,
  };

  /**
   * The config the route handed the renderer. Its type is a union, and only
   * some members declare the search fields, so the ones read here are added back.
   */
  function renderedConfig() {
    const [config] = mockRender.mock.calls[0];
    return config as typeof config & {
      where?: string;
      whereLanguage?: string;
      filters?: unknown[];
    };
  }

  beforeEach(() => {
    mockUserWithTeam.mockReturnValue({
      teamId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439099'),
      userId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439098'),
      email: 'analyst@dfe.test',
    });
    mockGetSource.mockResolvedValue(
      makeDocument<Awaited<ReturnType<typeof getSource>>>({
        name: 'JSON Demo',
        kind: 'log',
        from: { databaseName: 'dfe', tableName: 'default' },
        connection: '507f1f77bcf86cd799439022',
      }),
    );
    mockGetConnection.mockResolvedValue(
      makeDocument<Awaited<ReturnType<typeof getConnectionById>>>({
        host: 'http://clickhouse.test:8123',
        username: 'default',
        password: '',
      }),
    );
  });

  it("renders against the source's own table", async () => {
    const res = await request(app)
      .post('/dfe/export-sql')
      .send({ chartConfig: CHART_CONFIG });

    expect(res.status).toBe(200);
    expect(renderedConfig().from).toEqual({
      databaseName: 'dfe',
      tableName: 'default',
    });
  });

  it('keeps the search in the language the view ran it in', async () => {
    await request(app)
      .post('/dfe/export-sql')
      .send({ chartConfig: CHART_CONFIG });

    expect(renderedConfig().where).toBe('rulecycle');
    expect(renderedConfig().whereLanguage).toBe('lucene');
  });

  it('keeps every side-panel filter', async () => {
    await request(app)
      .post('/dfe/export-sql')
      .send({ chartConfig: CHART_CONFIG });

    expect(renderedConfig().filters).toEqual(FILTERS);
  });

  it('adds no placeholder the engine would have to expand', async () => {
    await request(app)
      .post('/dfe/export-sql')
      .send({ chartConfig: { ...CHART_CONFIG, where: '' } });

    const rendered = JSON.stringify(renderedConfig());
    expect(rendered).not.toContain('timestamp_condition');
    expect(rendered).not.toContain('{{');
    expect(renderedConfig().where).toBe('');
  });

  it('answers with the SQL the renderer produced', async () => {
    const res = await request(app)
      .post('/dfe/export-sql')
      .send({ chartConfig: CHART_CONFIG });

    expect(res.body.rawSql).toBe('SELECT 1');
  });
});
