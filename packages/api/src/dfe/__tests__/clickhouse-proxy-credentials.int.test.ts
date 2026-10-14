/**
 * Through the real app and the real proxy, ClickHouse sees the connection's
 * credentials and none of the caller's. A caller's Authorization beside the
 * proxy's X-ClickHouse-* headers is refused by ClickHouse with code 516
 * (`make dev-int FILE=clickhouse-proxy-credentials`).
 */
import http from 'http';

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  ...jest.requireActual('@/dfe/config'),
  get isDfeEnabled() {
    return mockDfeEnabled;
  },
}));
// The app imports it for the SQL export route; its ESM-only jose dependency does
// not load under jest.int.config.js, and nothing here verifies a token.
jest.mock('@/dfe/middleware/jwt-verify', () => ({ extractToken: jest.fn() }));
// Use the real proxy instead of the blanket mock in jest.setup.ts.
jest.unmock('http-proxy-middleware');

// Off while the app loads and the member signs in: DFE mode refuses the password login.
let mockDfeEnabled = false;

import { clearDBCollections, getLoggedInAgent, getServer } from '@/fixtures';
import Connection from '@/models/connection';

describe('the ClickHouse proxy and the caller credentials', () => {
  const server = getServer();

  let upstream: http.Server;
  let upstreamUrl: string;
  let seen: http.IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    await server.start();
    upstream = http.createServer((req, res) => {
      seen.push(req.headers);
      req.resume();
      req.on('end', () => {
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
    seen = [];
  });

  // MongoDB only: the upstream stands in for ClickHouse.
  afterEach(async () => {
    mockDfeEnabled = false;
    await clearDBCollections();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      upstream.close(err => (err ? reject(err) : resolve())),
    );
    await server.stop();
  });

  // A signed-in member searching with a bearer and a spoofed ClickHouse user.
  const searchAsCaller = async (dfe: boolean) => {
    const { agent, team } = await getLoggedInAgent(server);
    const connection = await Connection.create({
      team: team._id,
      name: 'team connection',
      host: upstreamUrl,
      username: 'team_user',
      password: 'team-pass',
    });
    mockDfeEnabled = dfe;
    const response = await agent
      .post('/clickhouse-proxy/?default_format=JSONCompact')
      .set('x-hyperdx-connection-id', connection._id.toString())
      .set('Authorization', 'Bearer engine-token')
      .set('X-ClickHouse-User', 'someone-else')
      .set('Content-Type', 'text/plain')
      .send('SELECT 1');
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    return seen[0];
  };

  it('in DFE mode ClickHouse sees the connection alone', async () => {
    const headers = await searchAsCaller(true);

    expect(headers).toMatchObject({
      'x-clickhouse-user': 'team_user',
      'x-clickhouse-key': 'team-pass',
    });
    expect(headers).not.toHaveProperty('authorization');
    expect(headers).not.toHaveProperty('cookie');
  });

  it('outside DFE mode the proxy is upstream and forwards them', async () => {
    const headers = await searchAsCaller(false);

    expect(headers.authorization).toBe('Bearer engine-token');
    expect(headers.cookie).toBeDefined();
  });
});
