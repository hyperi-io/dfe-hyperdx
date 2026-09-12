/**
 * DFE sources on every team.
 *
 * The invariant: a source the engine deploys lands on every team that has a
 * connection, over THAT team's connection, and the fork never writes or removes
 * a source it did not put there.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * Reading jest.Mock off a mocked module asserts a narrower type than the real
 * export; scoped here rather than relaxed in upstream's eslint config.
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

jest.mock('@/controllers/connection', () => ({
  getConnectionsByTeam: jest.fn(),
}));

jest.mock('@/controllers/sources', () => ({
  getSources: jest.fn(),
  createSource: jest.fn(),
  updateSource: jest.fn(),
  deleteSource: jest.fn(),
}));

jest.mock('@/models/team', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

jest.mock('@/dfe/models/dfe-source', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    deleteOne: jest.fn(),
    exists: jest.fn(),
  },
}));

import express from 'express';
import request from 'supertest';

import { getConnectionsByTeam } from '@/controllers/connection';
import {
  createSource,
  deleteSource,
  getSources,
  updateSource,
} from '@/controllers/sources';
import {
  isOwnedName,
  listByTeam,
  removeEverywhere,
  seedDfeSources,
  upsertEverywhere,
} from '@/dfe/controllers/dfe-sources';
import DfeSource from '@/dfe/models/dfe-source';
import dfeSourcesRouter from '@/dfe/routers/dfe-sources';
import Team from '@/models/team';

const mockTeams = Team.find as unknown as jest.Mock;
const mockManifest = DfeSource.find as unknown as jest.Mock;
const mockManifestUpsert = DfeSource.findOneAndUpdate as unknown as jest.Mock;
const mockManifestDelete = DfeSource.deleteOne as unknown as jest.Mock;
const mockManifestExists = DfeSource.exists as unknown as jest.Mock;
const mockConns = getConnectionsByTeam as jest.Mock;
const mockSources = getSources as jest.Mock;
const mockCreateSource = createSource as jest.Mock;
const mockUpdateSource = updateSource as jest.Mock;
const mockDeleteSource = deleteSource as jest.Mock;

// The body the engine PUTs: SourceSchemaNoId without `name` or `connection`.
const SPEC = {
  kind: 'log',
  from: { databaseName: 'dfe', tableName: 'filebeat' },
  timestampValueExpression: '_timestamp',
  displayedTimestampValueExpression: '_timestamp',
  implicitColumnExpression: '_json',
  bodyExpression: '_json',
  defaultTableSelectExpression: '_timestamp,_json',
};

// Two human teams plus the engine's own service team, which holds no connection.
const TEAMS = [
  { _id: 'team-admins', name: 'dfe-admins' },
  { _id: 'team-acme', name: 'customer-acme' },
  { _id: 'team-svc', name: 'dfe' },
];

const CONNECTIONS = new Map<string, { _id: string }[]>([
  ['team-admins', [{ _id: 'conn-admins' }]],
  ['team-acme', [{ _id: 'conn-acme' }]],
  ['team-svc', []],
]);

beforeEach(() => {
  jest.clearAllMocks();
  mockTeams.mockResolvedValue(TEAMS);
  mockConns.mockImplementation(
    async (team: string) => CONNECTIONS.get(team) ?? [],
  );
  mockSources.mockResolvedValue([]);
  mockCreateSource.mockImplementation(async () => ({ _id: 'new-source' }));
  mockUpdateSource.mockImplementation(async () => ({ _id: 'updated' }));
  mockDeleteSource.mockResolvedValue({});
  mockManifest.mockResolvedValue([]);
  mockManifestUpsert.mockResolvedValue({});
  mockManifestDelete.mockResolvedValue({});
  mockManifestExists.mockResolvedValue(null);
});

describe('upsertEverywhere', () => {
  test('writes the source to every team over that team own connection', async () => {
    const result = await upsertEverywhere('filebeat', SPEC);

    expect(result.written).toEqual(['dfe-admins', 'customer-acme']);
    expect(mockCreateSource).toHaveBeenCalledWith(
      'team-admins',
      expect.objectContaining({ name: 'filebeat', connection: 'conn-admins' }),
    );
    expect(mockCreateSource).toHaveBeenCalledWith(
      'team-acme',
      expect.objectContaining({ name: 'filebeat', connection: 'conn-acme' }),
    );
  });

  test('skips a team with no connection to hang the source on', async () => {
    // The engine's service team is exactly this case, which is why a source
    // written to it was invisible to every human.
    const result = await upsertEverywhere('filebeat', SPEC);

    expect(result.skipped).toEqual(['dfe']);
    expect(mockCreateSource).not.toHaveBeenCalledWith(
      'team-svc',
      expect.anything(),
    );
  });

  test('a re-deploy replaces the source rather than adding a second', async () => {
    mockSources.mockResolvedValue([{ _id: 'existing', name: 'filebeat' }]);

    await upsertEverywhere('filebeat', SPEC);

    expect(mockCreateSource).not.toHaveBeenCalled();
    expect(mockUpdateSource).toHaveBeenCalledWith(
      'team-admins',
      'existing',
      expect.objectContaining({ name: 'filebeat', connection: 'conn-admins' }),
    );
  });

  test('the spec passes through unaltered but for the per-team connection', async () => {
    await upsertEverywhere('filebeat', SPEC);

    expect(mockCreateSource).toHaveBeenCalledWith('team-admins', {
      ...SPEC,
      name: 'filebeat',
      connection: 'conn-admins',
    });
  });

  test('registers the source before writing it to any team', async () => {
    await upsertEverywhere('filebeat', SPEC);

    expect(mockManifestUpsert).toHaveBeenCalledWith(
      { name: 'filebeat' },
      { name: 'filebeat', spec: SPEC },
      expect.objectContaining({ upsert: true }),
    );
    expect(mockManifestUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateSource.mock.invocationCallOrder[0],
    );
  });

  test('one failing team costs the others nothing', async () => {
    mockCreateSource.mockImplementation(async (team: string) => {
      if (team === 'team-admins') {
        throw new Error('mongo down');
      }
      return { _id: 'new-source' };
    });

    const result = await upsertEverywhere('filebeat', SPEC);

    expect(result.written).toEqual(['customer-acme']);
    expect(result.skipped).toEqual(['dfe-admins', 'dfe']);
  });
});

describe('removeEverywhere', () => {
  test('removes the source from every team holding it', async () => {
    mockSources.mockResolvedValue([
      { _id: 'src-1', name: 'filebeat' },
      { _id: 'src-2', name: 'main' },
    ]);

    const result = await removeEverywhere('filebeat');

    expect(result.removed).toEqual(['dfe-admins', 'customer-acme', 'dfe']);
    expect(mockDeleteSource).toHaveBeenCalledWith('team-admins', 'src-1');
    expect(mockDeleteSource).not.toHaveBeenCalledWith(
      expect.anything(),
      'src-2',
    );
  });

  test('drops the registration too, so a later team is not seeded with it', async () => {
    await removeEverywhere('filebeat');

    expect(mockManifestDelete).toHaveBeenCalledWith({ name: 'filebeat' });
  });

  test('a team that never had it is left alone', async () => {
    const result = await removeEverywhere('filebeat');

    expect(result.removed).toEqual([]);
    expect(mockDeleteSource).not.toHaveBeenCalled();
  });
});

describe('isOwnedName', () => {
  test('a registered name is the engine to write', async () => {
    mockManifestExists.mockResolvedValue({ _id: 'manifest-1' });
    mockSources.mockResolvedValue([{ _id: 'src-1', name: 'filebeat' }]);

    expect(await isOwnedName('filebeat')).toBe(true);
  });

  test('a seeded name the engine never pushed is refused', async () => {
    // `main` is seeded on every team over the landing table; replacing it would
    // retarget the landing view of every team at once.
    mockSources.mockResolvedValue([{ _id: 'src-1', name: 'main' }]);

    expect(await isOwnedName('main')).toBe(false);
  });

  test('a name nothing holds yet is free', async () => {
    expect(await isOwnedName('filebeat')).toBe(true);
  });
});

describe('listByTeam', () => {
  test('reports only the registered sources, per team', async () => {
    mockManifest.mockResolvedValue([{ name: 'filebeat', spec: SPEC }]);
    mockSources.mockResolvedValue([
      { _id: 'src-1', name: 'filebeat', from: SPEC.from },
      { _id: 'src-2', name: 'main', from: { databaseName: 'dfe' } },
    ]);

    const listing = await listByTeam();

    expect(listing.map(entry => entry.teamName)).toEqual([
      'dfe-admins',
      'customer-acme',
      'dfe',
    ]);
    expect(listing[0].sources).toEqual([
      { id: 'src-1', name: 'filebeat', from: SPEC.from },
    ]);
  });
});

describe('seedDfeSources', () => {
  test('a team created later gets every registered source', async () => {
    mockManifest.mockResolvedValue([
      { name: 'filebeat', spec: SPEC },
      { name: 'syslog', spec: SPEC },
    ]);

    const seeded = await seedDfeSources('team-new', 'conn-new');

    expect(seeded).toEqual(['filebeat', 'syslog']);
    expect(mockCreateSource).toHaveBeenCalledWith(
      'team-new',
      expect.objectContaining({ name: 'filebeat', connection: 'conn-new' }),
    );
    // The connection is the one just created for the team, not a lookup.
    expect(mockConns).not.toHaveBeenCalledWith('team-new');
  });

  test('one bad entry does not cost the team the rest', async () => {
    mockManifest.mockResolvedValue([
      { name: 'filebeat', spec: SPEC },
      { name: 'syslog', spec: SPEC },
    ]);
    mockCreateSource.mockImplementationOnce(async () => {
      throw new Error('invalid source');
    });

    expect(await seedDfeSources('team-new', 'conn-new')).toEqual(['syslog']);
  });

  test('an empty manifest seeds nothing', async () => {
    expect(await seedDfeSources('team-new', 'conn-new')).toEqual([]);
    expect(mockCreateSource).not.toHaveBeenCalled();
  });
});

describe('the /dfe/sources routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/dfe/sources', dfeSourcesRouter);

  test('PUT registers the source and reports where it landed', async () => {
    const res = await request(app).put('/dfe/sources/filebeat').send(SPEC);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'filebeat',
      written: ['dfe-admins', 'customer-acme'],
      skipped: ['dfe'],
    });
  });

  test('PUT refuses a seeded name', async () => {
    mockSources.mockResolvedValue([{ _id: 'src-1', name: 'main' }]);

    const res = await request(app).put('/dfe/sources/main').send(SPEC);

    expect(res.status).toBe(409);
    expect(mockCreateSource).not.toHaveBeenCalled();
    expect(mockUpdateSource).not.toHaveBeenCalled();
  });

  test('PUT refuses a body with no table to read', async () => {
    const res = await request(app)
      .put('/dfe/sources/filebeat')
      .send({ kind: 'log', timestampValueExpression: '_timestamp' });

    expect(res.status).toBe(400);
    expect(mockManifestUpsert).not.toHaveBeenCalled();
  });

  test('PUT refuses a body with no timestamp expression', async () => {
    // The fork rejects a source whose timestamp expression is empty, and the
    // failure would otherwise surface per team rather than at the request.
    const res = await request(app)
      .put('/dfe/sources/filebeat')
      .send({ kind: 'log', from: SPEC.from });

    expect(res.status).toBe(400);
  });

  test('DELETE reports the teams it removed the source from', async () => {
    mockSources.mockResolvedValue([{ _id: 'src-1', name: 'filebeat' }]);

    const res = await request(app).delete('/dfe/sources/filebeat');

    expect(res.status).toBe(200);
    expect(res.body.removed).toEqual(['dfe-admins', 'customer-acme', 'dfe']);
  });

  test('GET lists the registered sources per team', async () => {
    mockManifest.mockResolvedValue([{ name: 'filebeat', spec: SPEC }]);
    mockSources.mockResolvedValue([
      { _id: 'src-1', name: 'filebeat', from: SPEC.from },
    ]);

    const res = await request(app).get('/dfe/sources');

    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(3);
    expect(res.body.teams[0]).toEqual({
      team: 'team-admins',
      teamName: 'dfe-admins',
      sources: [{ id: 'src-1', name: 'filebeat', from: SPEC.from }],
    });
  });
});
