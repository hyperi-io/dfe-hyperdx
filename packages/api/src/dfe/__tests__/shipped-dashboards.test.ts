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

import path from 'path';

import { suppressedDashboardNames } from '@/dfe/models/dashboard-tombstone';
import Dashboard from '@/models/dashboard';
import { syncDashboards } from '@/tasks/provisionDashboards';

const mockFindOneAndUpdate = jest.mocked(Dashboard.findOneAndUpdate);
const mockSuppressed = jest.mocked(suppressedDashboardNames);

const TEAM = '507f1f77bcf86cd799439099';

// Two shipped dashboards, "Deleted One" and "Kept One".
const SHIPPED_DIR = path.join(__dirname, 'fixtures', 'shipped-dashboards');

function provisionedNames(): string[] {
  return mockFindOneAndUpdate.mock.calls
    .map(call => call[0]?.name)
    .filter((name): name is string => typeof name === 'string');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSuppressed.mockResolvedValue(new Set<string>());
  mockFindOneAndUpdate.mockResolvedValue(null);
});

describe('syncDashboards - tombstones', () => {
  test('a tombstoned name is skipped, the rest still provision', async () => {
    mockSuppressed.mockResolvedValue(new Set(['Deleted One']));

    await syncDashboards(TEAM, SHIPPED_DIR);

    expect(provisionedNames()).toEqual(['Kept One']);
  });

  test('with no tombstone every shipped dashboard is provisioned', async () => {
    await syncDashboards(TEAM, SHIPPED_DIR);

    expect(provisionedNames().sort()).toEqual(['Deleted One', 'Kept One']);
  });

  test('the tombstone lookup is scoped to the team being synced', async () => {
    await syncDashboards(TEAM, SHIPPED_DIR);

    expect(mockSuppressed).toHaveBeenCalledWith(TEAM);
  });

  test('a newer shipped version of a deleted dashboard stays deleted', async () => {
    mockSuppressed.mockResolvedValue(new Set(['Deleted One']));

    await syncDashboards(TEAM, SHIPPED_DIR);
    await syncDashboards(TEAM, SHIPPED_DIR);

    expect(provisionedNames()).toEqual(['Kept One', 'Kept One']);
  });
});
