/**
 * Putting the shipped dashboards back.
 *
 * Restoring is not just clearing the tombstones: the provisioner runs once a
 * minute, so the route reprovisions inside the request or the list stays empty
 * until the next cron tick. The pass is skipped when no provisioner directory is
 * mounted, and the caller is told, rather than being shown a silent success.
 *
 * It reprovisions for the whole team, so the route is DFE-only, refuses a
 * request a cross-site page could have produced, and honours a role claim when
 * the token carries one.
 */

jest.mock('@/dfe/config', () => ({
  __esModule: true,
  get isDfeEnabled() {
    return mockDfeEnabled;
  },
}));

let mockDfeEnabled = true;

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('@/middleware/auth', () => ({
  __esModule: true,
  getNonNullUserWithTeam: jest.fn(() => ({
    teamId: '507f1f77bcf86cd799439099',
  })),
}));

jest.mock('@/dfe/models/dashboard-tombstone', () => ({
  __esModule: true,
  clearDashboardTombstones: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/tasks/provisionDashboards', () => ({
  __esModule: true,
  syncDashboards: jest.fn().mockResolvedValue(undefined),
}));

const TEAM = '507f1f77bcf86cd799439099';

import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

import { clearDashboardTombstones } from '@/dfe/models/dashboard-tombstone';
import shippedDashboardsRouter from '@/dfe/routers/shipped-dashboards';
import { syncDashboards } from '@/tasks/provisionDashboards';

const mockClear = jest.mocked(clearDashboardTombstones);
const mockSync = jest.mocked(syncDashboards);

let mockRole: string | undefined;

const app = express();
app.use(express.json());
// Stands in for the engine JWT middleware, which is what sets the role claim.
app.use((req, _res, next) => {
  req.dfeRole = mockRole;
  next();
});
app.use('/dfe', shippedDashboardsRouter);

/** A POST shaped the way the console sends it. */
function restore() {
  return request(app)
    .post('/dfe/dashboards/restore-shipped')
    .set('X-Requested-With', 'dfe-console');
}

let tmpDir: string;

beforeEach(() => {
  jest.clearAllMocks();
  mockDfeEnabled = true;
  mockRole = undefined;
  mockClear.mockResolvedValue(0);
  mockSync.mockResolvedValue(undefined);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfe-restore-'));
  process.env.DASHBOARD_PROVISIONER_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DASHBOARD_PROVISIONER_DIR;
  delete process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /dfe/dashboards/restore-shipped', () => {
  test('clears the team tombstones and reprovisions in the same request', async () => {
    mockClear.mockResolvedValue(2);

    const res = await restore();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cleared: 2, reprovisioned: true });
    expect(mockClear).toHaveBeenCalledWith(TEAM);
    expect(mockSync).toHaveBeenCalledWith(TEAM, tmpDir, false);
  });

  test('carries the provisioner strictness flag through', async () => {
    process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS = 'true';

    await restore();

    expect(mockSync).toHaveBeenCalledWith(TEAM, tmpDir, true);
  });

  test('with no provisioner directory it says so instead of claiming success', async () => {
    delete process.env.DASHBOARD_PROVISIONER_DIR;

    const res = await restore();

    expect(res.body).toEqual({ cleared: 0, reprovisioned: false });
    expect(mockSync).not.toHaveBeenCalled();
  });

  test('a directory that is configured but absent does not reprovision', async () => {
    process.env.DASHBOARD_PROVISIONER_DIR = path.join(tmpDir, 'gone');

    const res = await restore();

    expect(res.body.reprovisioned).toBe(false);
    expect(mockSync).not.toHaveBeenCalled();
  });

  test('outside DFE mode the route does not exist', async () => {
    mockDfeEnabled = false;

    const res = await restore();

    expect(res.status).toBe(404);
    expect(mockClear).not.toHaveBeenCalled();
  });
});

describe('POST /dfe/dashboards/restore-shipped - cross-site protection', () => {
  test('a simple post, which is what a hostile form produces, is refused', async () => {
    const res = await request(app).post('/dfe/dashboards/restore-shipped');

    expect(res.status).toBe(403);
    expect(mockClear).not.toHaveBeenCalled();
  });

  test('an Origin from another site is refused', async () => {
    const res = await request(app)
      .post('/dfe/dashboards/restore-shipped')
      .set('Origin', 'https://evil.example');

    expect(res.status).toBe(403);
    expect(mockClear).not.toHaveBeenCalled();
  });

  test('the app own origin is accepted without the header', async () => {
    const res = await request(app)
      .post('/dfe/dashboards/restore-shipped')
      .set('Host', 'console.example')
      .set('Origin', 'https://console.example');

    expect(res.status).toBe(200);
  });
});

describe('POST /dfe/dashboards/restore-shipped - the role claim', () => {
  test('no claim leaves team membership as the whole rule', async () => {
    const res = await restore();

    expect(res.status).toBe(200);
  });

  test.each(['admin', 'owner', 'Owner'])('%s may restore', async role => {
    mockRole = role;

    const res = await restore();

    expect(res.status).toBe(200);
  });

  test('a claim that is neither is refused', async () => {
    mockRole = 'viewer';

    const res = await restore();

    expect(res.status).toBe(403);
    expect(mockClear).not.toHaveBeenCalled();
  });
});
