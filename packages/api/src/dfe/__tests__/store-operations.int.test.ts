/**
 * The store operations dfe/ relies on that no other integration test reaches,
 * against a real store (`yarn ci:int`): a unique index raced by first logins, an
 * upsert on a compound unique index, and a Mixed field replaced whole. CI runs
 * this file on DocumentDB as well (.github/workflows/dfe-documentdb.yml).
 */

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  ...jest.requireActual('@/dfe/config'),
  DFE_AUTH_MODE: 'oidc-proxy',
}));

import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

import * as config from '@/config';
import {
  isOwnedName,
  listByTeam,
  removeEverywhere,
  upsertEverywhere,
} from '@/dfe/controllers/dfe-sources';
import { findOrCreateTeamByName } from '@/dfe/controllers/team-provisioning';
import DfeDashboardTombstone, {
  clearDashboardTombstones,
  recordDashboardTombstone,
  suppressedDashboardNames,
} from '@/dfe/models/dashboard-tombstone';
import DfeSource from '@/dfe/models/dfe-source';
import dfeSourcesRouter from '@/dfe/routers/dfe-sources';
import Connection from '@/models/connection';
import { Source } from '@/models/source';
import Team from '@/models/team';

// These tests lose races on purpose, and a retry would pass a race that was lost.
jest.retryTimes(0);

// Rounds of two, because one round of a race can win by luck.
const RACE_ROUNDS = 10;

describe('dfe store operations against a real store', () => {
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

  test('first logins racing on a new team name all land on one team', async () => {
    const logins = await Promise.all(
      Array.from({ length: 5 }, () => findOrCreateTeamByName('dfe_org_race')),
    );

    const teamIds = new Set(logins.map(login => String(login.team._id)));
    expect(teamIds.size).toBe(1);
    expect(logins.filter(login => login.created)).toHaveLength(1);
    expect(await Team.countDocuments({ name: 'dfe_org_race' })).toBe(1);
  });

  test('a second team of an existing name is refused with a duplicate key', async () => {
    await findOrCreateTeamByName('dfe_org_taken');

    await expect(Team.create({ name: 'dfe_org_taken' })).rejects.toMatchObject({
      code: 11000,
    });
  });

  test('a tombstone is upserted once per team and name, and cleared per team', async () => {
    const teamA = String(new mongoose.Types.ObjectId());
    const teamB = String(new mongoose.Types.ObjectId());

    await recordDashboardTombstone('Overview', teamA);
    const first = await DfeDashboardTombstone.findOne({
      name: 'Overview',
      team: teamA,
    }).lean();
    await recordDashboardTombstone('Overview', teamA);
    await recordDashboardTombstone('Ingest', teamA);
    await recordDashboardTombstone('Overview', teamB);

    expect(await DfeDashboardTombstone.countDocuments({ team: teamA })).toBe(2);
    const again = await DfeDashboardTombstone.findOne({
      name: 'Overview',
      team: teamA,
    }).lean();
    expect(String(again?._id)).toBe(String(first?._id));
    expect(again?.deletedAt.getTime()).toBeGreaterThanOrEqual(
      first?.deletedAt.getTime() ?? Infinity,
    );
    expect(await suppressedDashboardNames(teamA)).toEqual(
      new Set(['Overview', 'Ingest']),
    );

    expect(await clearDashboardTombstones(teamA)).toBe(2);
    expect(await suppressedDashboardNames(teamA)).toEqual(new Set());
    expect(await suppressedDashboardNames(teamB)).toEqual(
      new Set(['Overview']),
    );
  });

  test('the tombstone index refuses a second row for one team and name', async () => {
    await DfeDashboardTombstone.init();
    const team = new mongoose.Types.ObjectId();
    await DfeDashboardTombstone.create({
      name: 'Overview',
      team,
      deletedAt: new Date(),
    });

    await expect(
      DfeDashboardTombstone.create({
        name: 'Overview',
        team,
        deletedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  // MongoDB retries the losing upsert itself, but DocumentDB fails it with 11000 or 112.
  test('racing deletes of one shipped dashboard both succeed and leave one tombstone', async () => {
    await DfeDashboardTombstone.init();

    for (let round = 0; round < RACE_ROUNDS; round++) {
      const team = String(new mongoose.Types.ObjectId());
      await Promise.all([
        recordDashboardTombstone('Overview', team),
        recordDashboardTombstone('Overview', team),
      ]);
      expect(await DfeDashboardTombstone.countDocuments({ team })).toBe(1);
    }
  });

  const sourcesApp = express();
  sourcesApp.use(express.json());
  sourcesApp.use('/dfe/sources', dfeSourcesRouter);
  const putSource = (name: string) =>
    request(sourcesApp)
      .put(`/dfe/sources/${name}`)
      .send({
        kind: 'log',
        from: { databaseName: 'dfe', tableName: name },
        timestampValueExpression: '_timestamp',
      });

  test('racing PUTs of one source both answer 200 and leave one manifest entry', async () => {
    await DfeSource.init();

    for (let round = 0; round < RACE_ROUNDS; round++) {
      const name = `syslog_${round}`;
      const answers = await Promise.all([putSource(name), putSource(name)]);
      expect(answers.map(answer => answer.status)).toEqual([200, 200]);
      expect(await DfeSource.countDocuments({ name })).toBe(1);
    }
  });

  test('racing PUTs of one source onto a connected team leave that team one source', async () => {
    await DfeSource.init();
    const team = await Team.create({ name: 'acme' });
    await Connection.create({
      team: team._id,
      name: 'acme',
      host: 'http://ch:8123',
      username: 'dfe_org_acme',
      password: 'pw',
    });

    for (let round = 0; round < RACE_ROUNDS; round++) {
      const name = `firewall_${round}`;
      const answers = await Promise.all([putSource(name), putSource(name)]);
      expect(answers.map(answer => answer.status)).toEqual([200, 200]);
      expect(answers.map(answer => answer.body.written)).toEqual([
        ['acme'],
        ['acme'],
      ]);
      expect(await Source.countDocuments({ team: team._id, name })).toBe(1);
    }
  });

  test('the source manifest holds a nested spec and a push replaces it whole', async () => {
    const team = await Team.create({ name: 'acme' });
    const first = {
      kind: 'log',
      from: { databaseName: 'dfe', tableName: 'syslog' },
      timestampValueExpression: '_timestamp',
    };
    const second = {
      kind: 'log',
      from: { databaseName: 'dfe', tableName: 'syslog_v2' },
    };

    // acme holds no connection, so the source has nothing to hang on there.
    expect(await upsertEverywhere('syslog', first)).toEqual({
      written: [],
      skipped: ['acme'],
    });
    expect((await DfeSource.findOne({ name: 'syslog' }).lean())?.spec).toEqual(
      first,
    );

    await upsertEverywhere('syslog', second);
    expect(await DfeSource.countDocuments({ name: 'syslog' })).toBe(1);
    expect((await DfeSource.findOne({ name: 'syslog' }).lean())?.spec).toEqual(
      second,
    );
    expect(await isOwnedName('syslog')).toBe(true);
    expect(await listByTeam()).toEqual([
      { team: String(team._id), teamName: 'acme', sources: [] },
    ]);

    expect(await removeEverywhere('syslog')).toEqual({ removed: [] });
    expect(await DfeSource.exists({ name: 'syslog' })).toBeNull();
  });
});
