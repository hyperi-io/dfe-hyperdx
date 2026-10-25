/**
 * The seed claim's settled mark, and the first-login race it closes, against a
 * real store (`yarn ci:int`). CI runs this file on DocumentDB as well
 * (.github/workflows/dfe-documentdb.yml).
 *
 * The engine is the only stub: its connection read answers from `global.fetch`.
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

import { setTimeout as delay } from 'node:timers/promises';

import mongoose from 'mongoose';

import * as config from '@/config';
import { getSources } from '@/controllers/sources';
import { upsertEverywhere } from '@/dfe/controllers/dfe-sources';
import {
  clearTeamSeedCache,
  ensureOrgConnection,
} from '@/dfe/controllers/org-connection';
import DfeTeamSeed, {
  awaitTeamSeed,
  claimTeamSeed,
  settleTeamSeed,
} from '@/dfe/models/team-seed';
import Team from '@/models/team';

// These tests race on purpose, and a retry would pass a race that was lost.
jest.retryTimes(0);

const ORG = 'dfe_org_acme';

const material = {
  name: 'acme',
  host: 'http://ch:8123',
  username: ORG,
  password: 'pw',
};

// Slow enough that every request reaches the store while the first is still seeding.
const ENGINE_DELAY_MS = 300;

describe('the team seed claim against a real store', () => {
  beforeAll(async () => {
    if (!config.IS_CI || config.MONGO_URI == null) {
      throw new Error('needs NODE_ENV=test and a disposable MONGO_URI');
    }
    await mongoose.connect(config.MONGO_URI);
    await DfeTeamSeed.init();
  });

  afterEach(async () => {
    clearTeamSeedCache();
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

  test('every first-login request on a new team answers only once the registered sources are on it', async () => {
    // Registered before the team exists, so only the team's seed can put it there.
    await upsertEverywhere('filebeat', {
      kind: 'log',
      from: { databaseName: 'dfe', tableName: 'filebeat' },
      timestampValueExpression: '_timestamp',
    });
    const team = String((await Team.create({ name: ORG }))._id);
    (global.fetch as jest.Mock).mockImplementation(async () => {
      await delay(ENGINE_DELAY_MS);
      return { ok: true, status: 200, json: async () => material };
    });

    const seen = await Promise.all(
      [1, 2, 3].map(async () => {
        const outcome = await ensureOrgConnection('tok', team, ORG);
        const sources = await getSources(team);
        return { outcome, names: sources.map(s => s.name).sort() };
      }),
    );

    expect(seen.map(s => s.outcome).sort()).toEqual([
      'present',
      'present',
      'seeded',
    ]);
    for (const { names } of seen) {
      expect(names).toEqual(['filebeat', 'hunts', 'main']);
    }
  });

  test('a team with no claim, or a lapsed one, has nothing to wait for', async () => {
    const team = String(new mongoose.Types.ObjectId());
    expect(await awaitTeamSeed(team, 30_000)).toBe('idle');

    await claimTeamSeed(team, 30_000);
    await DfeTeamSeed.updateOne({ team }, { $set: { claimedAt: new Date(0) } });
    expect(await awaitTeamSeed(team, 30_000)).toBe('idle');
  });

  test('a waiter returns once the claim holder settles', async () => {
    const team = String(new mongoose.Types.ObjectId());
    expect(await claimTeamSeed(team, 30_000)).toBe('claimed');

    const [wait] = await Promise.all([
      awaitTeamSeed(team, 30_000),
      delay(ENGINE_DELAY_MS).then(() => settleTeamSeed(team)),
    ]);

    expect(wait).toBe('settled');
  });

  test('a claim that lapses unsettled ends the wait as a timeout', async () => {
    const team = String(new mongoose.Types.ObjectId());
    const leaseMs = 500;
    expect(await claimTeamSeed(team, leaseMs)).toBe('claimed');

    const started = Date.now();
    expect(await awaitTeamSeed(team, leaseMs)).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(leaseMs + 1_000);
  });

  test('a claim taken again after an earlier attempt settled is in flight again', async () => {
    const team = String(new mongoose.Types.ObjectId());
    const leaseMs = 500;
    await claimTeamSeed(team, leaseMs);
    await settleTeamSeed(team);
    expect(await awaitTeamSeed(team, leaseMs)).toBe('idle');

    await DfeTeamSeed.updateOne({ team }, { $set: { claimedAt: new Date(0) } });
    expect(await claimTeamSeed(team, leaseMs)).toBe('claimed');

    expect(await awaitTeamSeed(team, leaseMs)).toBe('timeout');
  });
});
