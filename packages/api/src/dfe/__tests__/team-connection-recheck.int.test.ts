/**
 * Through the real query proxy and MongoDB, a query ClickHouse refuses has the
 * next request carry the engine's password. The engine is stubbed at `fetch`.
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * the stand-in session user and the mocked fetch are narrower than the real types.
 */

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  ...jest.requireActual('@/dfe/config'),
  DFE_ENGINE_JWKS_URL: 'http://engine.test:8000/.well-known/jwks.json',
}));
// Use the real proxy instead of the blanket mock in jest.setup.ts.
jest.unmock('http-proxy-middleware');

import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import request from 'supertest';

import * as config from '@/config';
import {
  clearTeamSeedCache,
  ensureOrgConnection,
  recheckOnAuthFailure,
} from '@/dfe/controllers/org-connection';
import Connection from '@/models/connection';
import clickhouseProxyRouter from '@/routers/api/clickhouseProxy';

const ORG = 'dfe_org_acme';

describe('a team connection ClickHouse refuses, through the real proxy', () => {
  let upstream: http.Server;
  let upstreamUrl: string;
  let keys: string[] = [];

  beforeAll(async () => {
    if (!config.IS_CI || config.MONGO_URI == null) {
      throw new Error('needs NODE_ENV=test and a disposable MONGO_URI');
    }
    await mongoose.connect(config.MONGO_URI);
    // Answers a wrong password the way ClickHouse does: 403 and code 516.
    upstream = http.createServer((req, res) => {
      const key = String(req.headers['x-clickhouse-key'] ?? '');
      keys.push(key);
      req.resume();
      req.on('end', () => {
        if (key !== 'pw-new') {
          res.writeHead(403, {
            'Content-Type': 'text/plain',
            'X-ClickHouse-Exception-Code': '516',
          });
          res.end('Code: 516. DB::Exception: Authentication failed');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [['1']] }));
      });
    });
    await new Promise<void>(resolve => upstream.listen(0, resolve));
    const address = upstream.address();
    if (address == null || typeof address === 'string') {
      throw new Error('Expected the upstream to listen on a TCP port');
    }
    upstreamUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    keys = [];
    clearTeamSeedCache();
  });

  afterEach(async () => {
    await Connection.deleteMany({});
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      upstream.close(err => (err ? reject(err) : resolve())),
    );
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  // The identity middleware's two calls, for a signed-in member of `teamId`.
  const appFor = (teamId: string) => {
    const app = express();
    app.use(express.text());
    app.use(async (req, res, next) => {
      await ensureOrgConnection('tok', teamId, ORG);
      recheckOnAuthFailure(res, teamId);
      req.user = {
        _id: 'user-1',
        email: 'jo@example.test',
        team: teamId,
      } as unknown as Express.User;
      next();
    });
    app.use('/clickhouse-proxy', clickhouseProxyRouter);
    return app;
  };

  it('the query after a refusal goes out with the engine password', async () => {
    const team = new mongoose.Types.ObjectId();
    const connection = await Connection.create({
      team,
      name: 'acme',
      host: upstreamUrl,
      username: ORG,
      password: 'pw-old',
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'acme',
        host: upstreamUrl,
        username: ORG,
        password: 'pw-new',
      }),
    });
    const app = appFor(String(team));
    const query = () =>
      request(app)
        .post('/clickhouse-proxy/?default_format=JSONCompact')
        .set('x-hyperdx-connection-id', String(connection._id))
        .set('Content-Type', 'text/plain')
        .send('SELECT 1');

    const refused = await query();
    expect(refused.status).toBe(403);
    expect(refused.headers['x-clickhouse-exception-code']).toBe('516');

    const answered = await query();
    expect(answered.status).toBe(200);

    expect(keys).toEqual(['pw-old', 'pw-new']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const stored = await Connection.findById(connection._id).select(
      '+password',
    );
    expect(stored?.password).toBe('pw-new');
  });
});
