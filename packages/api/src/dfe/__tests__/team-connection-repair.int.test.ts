/**
 * The team-connection repair, the one-connection-per-team index and the seed
 * race, against a real MongoDB (`yarn ci:int`).
 *
 * The engine is the only stub: its connection read answers from `global.fetch`.
 * Everything else - the models, the controllers, the unique index and its
 * duplicate-key error - is the store's own behaviour.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Reading jest.Mock off the global fetch asserts a narrower type than the real one.
 */

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  ...jest.requireActual('@/dfe/config'),
  DFE_AUTH_MODE: 'oidc-proxy',
  DFE_ENGINE_JWKS_URL: 'http://engine.test:8000/.well-known/jwks.json',
}));

import mongoose from 'mongoose';

import * as config from '@/config';
import { getSources } from '@/controllers/sources';
import { ensureOrgConnection } from '@/dfe/controllers/org-connection';
import { repairTeamConnections } from '@/dfe/tasks/team-connection-repair';
import Connection from '@/models/connection';
import Dashboard from '@/models/dashboard';
import Team from '@/models/team';
import User from '@/models/user';

const ORG = 'dfe_org_acme';
const PLATFORM = 'dfe_query_reader';

const material = (username: string) => ({
  name: username === PLATFORM ? 'platform' : 'acme',
  host: 'http://ch:8123',
  username,
  password: 'pw',
});

const engineHands = (username: string) =>
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => material(username),
  });

const connectionOn = (team: mongoose.Types.ObjectId, username: string) =>
  Connection.create({ ...material(username), team });

// @/fixtures loads the whole app, and with it jose, which this jest config cannot parse.
describe('team connections against a real store', () => {
  beforeAll(async () => {
    if (!config.IS_CI || config.MONGO_URI == null) {
      throw new Error('needs NODE_ENV=test and a disposable MONGO_URI');
    }
    await mongoose.connect(config.MONGO_URI);
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

  test('the repair deletes a group-seeded connection and touches no user or content', async () => {
    const group = await Team.create({ name: 'acme-team' });
    const identity = await Team.create({ name: ORG });
    await User.create({ email: 'admin@example.test', team: group._id });
    await User.create({ email: 'viewer@example.test', team: group._id });
    await Dashboard.create({ name: 'kept', tiles: [], team: group._id });
    await connectionOn(group._id, PLATFORM);
    const own = await connectionOn(identity._id, ORG);
    await connectionOn(new mongoose.Types.ObjectId(), 'dfe_org_nerk');

    const report = await repairTeamConnections();

    expect(report).toEqual({ checked: 3, deleted: 2 });
    const left = await Connection.find({}, 'team username').lean();
    expect(left.map(c => String(c._id))).toEqual([String(own._id)]);
    expect(await User.countDocuments({ team: group._id })).toBe(2);
    expect(await Dashboard.countDocuments({ team: group._id })).toBe(1);
  });

  test('after the repair the store refuses a second connection on one team', async () => {
    const identity = await Team.create({ name: ORG });
    await connectionOn(identity._id, ORG);
    await repairTeamConnections();

    await expect(connectionOn(identity._id, ORG)).rejects.toMatchObject({
      code: 11000,
    });
  });

  test('a seed that loses to another replica leaves exactly one connection', async () => {
    const identity = await Team.create({ name: ORG });
    // The other replica creates the connection between this one's check and its insert.
    (global.fetch as jest.Mock).mockImplementation(async () => {
      await connectionOn(identity._id, ORG);
      return { ok: true, status: 200, json: async () => material(ORG) };
    });

    const outcome = await ensureOrgConnection('tok', String(identity._id), ORG);

    expect(outcome).toBe('present');
    expect(await Connection.countDocuments({ team: identity._id })).toBe(1);
  });

  test('a failed first seed is retried, and the team ends with its own connection and sources', async () => {
    const identity = await Team.create({ name: ORG });
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new TypeError('fetch failed'),
    );

    const first = await ensureOrgConnection('tok', String(identity._id), ORG);
    expect(first).toBe('unavailable');
    expect(await Connection.countDocuments({ team: identity._id })).toBe(0);

    engineHands(ORG);
    const second = await ensureOrgConnection('tok', String(identity._id), ORG);

    expect(second).toBe('seeded');
    const held = await Connection.find(
      { team: identity._id },
      'username',
    ).lean();
    expect(held.map(c => c.username)).toEqual([ORG]);
    const sources = await getSources(String(identity._id));
    expect(sources.map(s => s.name).sort()).toEqual(['hunts', 'main']);
  });

  test('an admin arriving first cannot seed an org team with the platform reader', async () => {
    const identity = await Team.create({ name: ORG });
    engineHands(PLATFORM);

    const outcome = await ensureOrgConnection('tok', String(identity._id), ORG);

    expect(outcome).toBe('mismatch');
    expect(await Connection.countDocuments({ team: identity._id })).toBe(0);
  });
});
