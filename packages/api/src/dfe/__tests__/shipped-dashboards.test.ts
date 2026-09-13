/**
 * A deleted shipped dashboard stays deleted.
 *
 * The provisioner upserts by {name, team} once a minute, so the tombstone is the
 * only thing standing between a delete and the dashboard reappearing. The way
 * back is the restore route, covered in restore-shipped.test.ts.
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

jest.mock('@/controllers/sources', () => ({
  __esModule: true,
  getSources: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/controllers/connection', () => ({
  __esModule: true,
  getConnectionsByTeam: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/models/dashboard', () => ({
  __esModule: true,
  default: {
    exists: jest.fn().mockResolvedValue(null),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@/dfe/models/dashboard-tombstone', () => ({
  __esModule: true,
  suppressedDashboardNames: jest.fn().mockResolvedValue(new Set<string>()),
}));

import fs from 'fs';
import os from 'os';
import path from 'path';

import { suppressedDashboardNames } from '@/dfe/models/dashboard-tombstone';
import Dashboard from '@/models/dashboard';
import { syncDashboards } from '@/tasks/provisionDashboards';

const mockFindOneAndUpdate = jest.mocked(Dashboard.findOneAndUpdate);
const mockSuppressed = jest.mocked(suppressedDashboardNames);

const TEAM = '507f1f77bcf86cd799439099';

const TILE = {
  id: '507f1f77bcf86cd799439011',
  x: 1,
  y: 1,
  w: 1,
  h: 1,
  config: {
    name: 'Test Chart',
    source: 'test-source',
    displayType: 'line',
    select: [
      {
        aggFn: 'count',
        aggCondition: '',
        aggConditionLanguage: 'lucene',
        valueExpression: '',
      },
    ],
    where: '',
    whereLanguage: 'lucene',
  },
};

let tmpDir: string;

function writeDashboard(name: string) {
  fs.writeFileSync(
    path.join(tmpDir, `${name.toLowerCase().replace(/\s+/g, '-')}.json`),
    JSON.stringify({ name, tiles: [TILE], tags: [] }),
  );
}

function provisionedNames(): string[] {
  return mockFindOneAndUpdate.mock.calls
    .map(call => call[0]?.name)
    .filter((name): name is string => typeof name === 'string');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSuppressed.mockResolvedValue(new Set<string>());
  mockFindOneAndUpdate.mockResolvedValue(null);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfe-shipped-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('syncDashboards - tombstones', () => {
  test('a tombstoned name is skipped, the rest still provision', async () => {
    writeDashboard('Deleted One');
    writeDashboard('Kept One');
    mockSuppressed.mockResolvedValue(new Set(['Deleted One']));

    await syncDashboards(TEAM, tmpDir);

    expect(provisionedNames()).toEqual(['Kept One']);
  });

  test('with no tombstone every shipped dashboard is provisioned', async () => {
    writeDashboard('Kept One');

    await syncDashboards(TEAM, tmpDir);

    expect(provisionedNames()).toEqual(['Kept One']);
  });

  test('the tombstone lookup is scoped to the team being synced', async () => {
    writeDashboard('Kept One');

    await syncDashboards(TEAM, tmpDir);

    expect(mockSuppressed).toHaveBeenCalledWith(TEAM);
  });

  test('a newer shipped version of a deleted dashboard stays deleted', async () => {
    writeDashboard('Deleted One');
    mockSuppressed.mockResolvedValue(new Set(['Deleted One']));

    await syncDashboards(TEAM, tmpDir);
    await syncDashboards(TEAM, tmpDir);

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
