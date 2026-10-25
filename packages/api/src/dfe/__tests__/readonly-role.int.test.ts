/**
 * Through the real app, the real engine-token check and a real store
 * (`yarn ci:int`): a `viewer` sharing a team with a `member` reads what the
 * member saved and changes none of it. The engine is the only stub, answered
 * from `global.fetch`, and its tokens are signed with a generated ES384 key.
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
import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';
import { Source } from '@/models/source';
import Team from '@/models/team';

const ISSUER = 'http://engine.test:8000';
const ORG = 'dfe_org_acme';

const MEMBER = 'member@example.test';
const VIEWER = 'viewer@example.test';

// The read-only refusal, as opposed to the admin-surface lockdown's 403.
const READ_ONLY_REFUSAL = { error: expect.stringContaining('read-only') };

let privateKey: CryptoKey;
const tokens: Record<string, string> = {};

const sign = (sub: string) =>
  new SignJWT({ sub })
    .setProtectedHeader({ alg: 'ES384' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime('5m')
    .sign(privateKey);

const answer = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

// GET /api/v1/auth/me and GET /api/v1/hyperdx/connection, keyed on the bearer.
function engineAnswers(roles: Record<string, string>) {
  (global.fetch as jest.Mock).mockImplementation(
    async (url: string, init?: { headers?: Record<string, string> }) => {
      const bearer = init?.headers?.Authorization ?? '';
      const role = Object.entries(tokens).find(
        ([, token]) => bearer === `Bearer ${token}`,
      )?.[0];
      if (url === `${ISSUER}/api/v1/auth/me`) {
        return answer({
          user_id: role,
          groups: ['acme'],
          hyperdx_identity: ORG,
          hyperdx_role: role === undefined ? undefined : roles[role],
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

const savedSearchBody = (source: string, name: string) => ({
  name,
  select: '_timestamp,_json',
  where: '',
  whereLanguage: 'sql',
  orderBy: '',
  source,
  tags: [],
  filters: [],
});

describe('a read-only role through the real app', () => {
  let source: string;

  beforeAll(async () => {
    if (!config.IS_CI || config.MONGO_URI == null) {
      throw new Error('needs NODE_ENV=test and a disposable MONGO_URI');
    }
    await mongoose.connect(config.MONGO_URI);
    const pair = await generateKeyPair('ES384');
    privateKey = pair.privateKey;
    mockPublicKey = pair.publicKey;
    tokens[MEMBER] = await sign(MEMBER);
    tokens[VIEWER] = await sign(VIEWER);
  });

  beforeEach(async () => {
    clearEngineSessionCache();
    clearTeamSeedCache();
    engineAnswers({ [MEMBER]: 'member', [VIEWER]: 'viewer' });
    // The member's first request names and seeds the team both share.
    const seeded = await as(MEMBER).get('/saved-search');
    expect(seeded.status).toBe(200);
    const team = await Team.findOne({ name: ORG });
    const teamSource = await Source.findOne({ team: team?._id });
    source = String(teamSource?._id);
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

  it('a member saves, edits and deletes a saved search', async () => {
    const created = await as(MEMBER)
      .post('/saved-search')
      .send(savedSearchBody(source, 'member search'));
    expect(created.status).toBe(200);

    const edited = await as(MEMBER)
      .patch(`/saved-search/${created.body.id}`)
      .send({ name: 'renamed' });
    expect(edited.status).toBe(200);

    const deleted = await as(MEMBER).delete(`/saved-search/${created.body.id}`);
    expect(deleted.status).toBe(204);
  });

  it('a member creates, edits and deletes a dashboard', async () => {
    const created = await as(MEMBER)
      .post('/dashboards')
      .send({ name: 'member board', tiles: [], tags: [] });
    expect(created.status).toBe(200);

    const edited = await as(MEMBER)
      .patch(`/dashboards/${created.body.id}`)
      .send({ name: 'renamed' });
    expect(edited.status).toBe(200);

    const deleted = await as(MEMBER).delete(`/dashboards/${created.body.id}`);
    expect(deleted.status).toBe(204);
  });

  it('a member pins filters on the team source', async () => {
    const pinned = await as(MEMBER)
      .put('/pinned-filters')
      .send({ source, fields: ['level'], filters: {} });

    expect(pinned.status).toBe(200);
  });

  it('a viewer reads the saved searches and dashboards', async () => {
    const searches = await as(VIEWER).get('/saved-search');
    const dashboards = await as(VIEWER).get('/dashboards');

    expect(searches.status).toBe(200);
    expect(dashboards.status).toBe(200);
  });

  it('a viewer cannot create a saved search', async () => {
    const created = await as(VIEWER)
      .post('/saved-search')
      .send(savedSearchBody(source, 'viewer search'));

    expect(created.status).toBe(403);
    expect(created.body).toEqual(READ_ONLY_REFUSAL);
    expect(await SavedSearch.countDocuments({ name: 'viewer search' })).toBe(0);
  });

  it("a viewer cannot edit or delete the member's saved search", async () => {
    const created = await as(MEMBER)
      .post('/saved-search')
      .send(savedSearchBody(source, 'member search'));
    const id = created.body.id;

    const edited = await as(VIEWER)
      .patch(`/saved-search/${id}`)
      .send({ name: 'defaced' });
    const deleted = await as(VIEWER).delete(`/saved-search/${id}`);

    expect(edited.status).toBe(403);
    expect(deleted.status).toBe(403);
    const stored = await SavedSearch.findById(id);
    expect(stored?.name).toBe('member search');
  });

  it('a viewer cannot create, edit or delete a dashboard', async () => {
    const owned = await as(MEMBER)
      .post('/dashboards')
      .send({ name: 'member board', tiles: [], tags: [] });
    const id = owned.body.id;

    const created = await as(VIEWER)
      .post('/dashboards')
      .send({ name: 'viewer board', tiles: [], tags: [] });
    const edited = await as(VIEWER)
      .patch(`/dashboards/${id}`)
      .send({ name: 'defaced' });
    const deleted = await as(VIEWER).delete(`/dashboards/${id}`);

    expect([created.status, edited.status, deleted.status]).toEqual([
      403, 403, 403,
    ]);
    expect(await Dashboard.countDocuments({ name: 'viewer board' })).toBe(0);
    const stored = await Dashboard.findById(id);
    expect(stored?.name).toBe('member board');
  });

  it.each([
    ['put', '/pinned-filters'],
    ['put', '/dashboards/preset/services/filter'],
    ['post', '/alerts'],
    ['post', '/webhooks'],
    ['post', '/connections'],
    ['post', '/sources'],
    ['patch', '/team/name'],
    ['post', '/dfe/dashboards/restore-shipped'],
  ] as const)('a viewer cannot %s %s', async (method, path) => {
    const res = await as(VIEWER)[method](path).send({});

    expect(res.status).toBe(403);
    expect(res.body).toEqual(READ_ONLY_REFUSAL);
  });

  it('a viewer keeps its own favourites', async () => {
    const owned = await as(MEMBER)
      .post('/dashboards')
      .send({ name: 'member board', tiles: [], tags: [] });

    const favourite = await as(VIEWER)
      .put('/favorites')
      .send({ resourceType: 'dashboard', resourceId: owned.body.id });

    expect(favourite.status).toBe(200);
  });
});
