/**
 * Through the real app, the real engine-token check and a real store
 * (`yarn ci:int`): a signed-in person reaches search, saved searches and
 * dashboards and none of the admin surface, only the engine's service identity
 * reaches that, and a session the engine gives no standing provisions nothing.
 * The engine is the only stub, answered from `global.fetch`, and its tokens are
 * signed with a generated ES384 key.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Reading jest.Mock off the global fetch asserts a narrower type than the real one.
 */

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  ...jest.requireActual('@/dfe/config'),
  DFE_AUTH_MODE: 'oidc-proxy',
  DFE_ENGINE_JWKS_URL: 'http://engine.test:8000/.well-known/jwks.json',
  DFE_ENGINE_ISSUER: 'http://engine.test:8000',
  isDfeEnabled: true,
}));

// The JWKS is the generated public key, and the signature check is real.
jest.mock('jose', () => ({
  ...jest.requireActual('jose'),
  createRemoteJWKSet: () => async () => mockPublicKey,
}));

let mockPublicKey: CryptoKey;

import { generateKeyPair, SignJWT } from 'jose';
import mongoose from 'mongoose';
import request from 'supertest';

import app from '@/api-app';
import * as config from '@/config';
import { clearEngineSessionCache } from '@/dfe/controllers/engine-session';
import { clearTeamSeedCache } from '@/dfe/controllers/org-connection';
import Connection from '@/models/connection';
import { Source } from '@/models/source';
import Team from '@/models/team';
import User from '@/models/user';

const ISSUER = 'http://engine.test:8000';
const ORG = 'dfe_org_acme';

const MEMBER = 'member@example.test';
const NO_STANDING = 'nobody@example.test';
const NO_GROUP = 'ungrouped@example.test';
const SERVICE = 'svc:dfe-engine';

const ENGINE_ONLY = {
  error: 'This surface is managed by the DFE engine and is not available here.',
};

let privateKey: CryptoKey;
const tokens: Record<string, string> = {};

const sign = (sub: string, audience?: string) => {
  const jwt = new SignJWT({ sub })
    .setProtectedHeader({ alg: 'ES384' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime('5m');
  return (audience ? jwt.setAudience(audience) : jwt).sign(privateKey);
};

const answer = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// What the engine says of each account: a member with a team identity, one with
// groups but no identity (no data-plane role), and one in no group at all.
function engineAnswers() {
  (global.fetch as jest.Mock).mockImplementation(
    async (url: string, init?: { headers?: Record<string, string> }) => {
      const bearer = init?.headers?.Authorization ?? '';
      const who = Object.entries(tokens).find(
        ([, token]) => bearer === `Bearer ${token}`,
      )?.[0];
      if (url === `${ISSUER}/api/v1/auth/me`) {
        return answer({
          user_id: who,
          groups: who === NO_GROUP ? [] : ['acme'],
          hyperdx_identity: who === MEMBER ? ORG : '',
          hyperdx_role: 'member',
        });
      }
      if (url === `${ISSUER}/api/v1/hyperdx/connection`) {
        return answer({
          name: 'acme',
          host: 'http://ch:8123',
          username: ORG,
          password: 'pw',
        });
      }
      return answer({}, 404);
    },
  );
}

const as = (who: string) => ({
  get: (path: string) =>
    request(app).get(path).set('Authorization', `Bearer ${tokens[who]}`),
  post: (path: string) =>
    request(app).post(path).set('Authorization', `Bearer ${tokens[who]}`),
  put: (path: string) =>
    request(app).put(path).set('Authorization', `Bearer ${tokens[who]}`),
  patch: (path: string) =>
    request(app).patch(path).set('Authorization', `Bearer ${tokens[who]}`),
  delete: (path: string) =>
    request(app).delete(path).set('Authorization', `Bearer ${tokens[who]}`),
});

describe('the admin surface through the real app', () => {
  beforeAll(async () => {
    if (!config.IS_CI || config.MONGO_URI == null) {
      throw new Error('needs NODE_ENV=test and a disposable MONGO_URI');
    }
    await mongoose.connect(config.MONGO_URI);
    const pair = await generateKeyPair('ES384');
    privateKey = pair.privateKey;
    mockPublicKey = pair.publicKey;
    tokens[MEMBER] = await sign(MEMBER);
    tokens[NO_STANDING] = await sign(NO_STANDING);
    tokens[NO_GROUP] = await sign(NO_GROUP);
    tokens[SERVICE] = await sign(SERVICE, 'dfe-hyperdx');
  });

  beforeEach(async () => {
    clearEngineSessionCache();
    clearTeamSeedCache();
    engineAnswers();
  });

  afterEach(async () => {
    await Promise.all(
      Object.values(mongoose.connection.collections).map(collection =>
        collection.deleteMany({}),
      ),
    );
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it.each([
    '/saved-search',
    '/dashboards',
    '/sources',
    '/connections',
    '/team',
  ])('a member reads %s', async path => {
    const res = await as(MEMBER).get(path);

    expect(res.status).toBe(200);
  });

  it.each([
    ['post', '/connections'],
    ['put', '/connections/507f1f77bcf86cd799439011'],
    ['delete', '/connections/507f1f77bcf86cd799439011'],
    ['post', '/sources'],
    ['put', '/sources/507f1f77bcf86cd799439011'],
    ['delete', '/sources/507f1f77bcf86cd799439011'],
    ['patch', '/team/name'],
    ['patch', '/team/apiKey'],
    ['patch', '/team/clickhouse-settings'],
    ['get', '/team/members'],
    ['get', '/team/invitations'],
    ['post', '/team/invitation'],
    ['delete', '/team/member/507f1f77bcf86cd799439011'],
    ['patch', '/me/accessKey'],
    ['get', '/iac/import-manifest'],
    ['get', '/webhooks'],
    ['post', '/webhooks'],
    ['post', '/alerts'],
    ['get', '/api/v2'],
    ['post', '/mcp'],
    ['post', '/clickhouse-proxy/test'],
    ['get', '/dfe/sources'],
  ] as const)('a member cannot %s %s', async (method, path) => {
    const res = await as(MEMBER)[method](path).send({});

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ENGINE_ONLY);
  });

  it('a member adds no connection and no source', async () => {
    await as(MEMBER).get('/saved-search');
    const connections = await Connection.countDocuments({});
    const sources = await Source.countDocuments({});

    await as(MEMBER).post('/connections').send({ name: 'mine' });
    await as(MEMBER).post('/sources').send({ name: 'mine' });

    expect(await Connection.countDocuments({})).toBe(connections);
    expect(await Source.countDocuments({})).toBe(sources);
  });

  it('the engine service identity reaches the team surface', async () => {
    const members = await as(SERVICE).get('/team/members');

    expect(members.status).toBe(200);
  });

  it.each([
    ['holds no data-plane identity', NO_STANDING],
    ['is in no group', NO_GROUP],
  ])('a session that %s is refused and provisions nothing', async (_, who) => {
    const res = await as(who).get('/saved-search');

    expect(res.status).toBe(403);
    expect(await User.countDocuments({ email: who })).toBe(0);
    expect(await Team.countDocuments({})).toBe(0);
  });
});
