/**
 * Putting the shipped dashboards back.
 *
 * Restoring is not just clearing the tombstones: the provisioner runs once a
 * minute, so the route reprovisions inside the request or the list stays empty
 * until the next cron tick. The pass is skipped when no provisioner directory is
 * mounted, and the caller is told, rather than being shown a silent success.
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

const app = express();
app.use(express.json());
app.use('/dfe', shippedDashboardsRouter);

let tmpDir: string;

beforeEach(() => {
  jest.clearAllMocks();
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

    const res = await request(app).post('/dfe/dashboards/restore-shipped');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cleared: 2, reprovisioned: true });
    expect(mockClear).toHaveBeenCalledWith(TEAM);
    expect(mockSync).toHaveBeenCalledWith(TEAM, tmpDir, false);
  });

  test('carries the provisioner strictness flag through', async () => {
    process.env.DASHBOARD_PROVISIONER_REQUIRE_REFS = 'true';

    await request(app).post('/dfe/dashboards/restore-shipped');

    expect(mockSync).toHaveBeenCalledWith(TEAM, tmpDir, true);
  });

  test('with no provisioner directory it says so instead of claiming success', async () => {
    delete process.env.DASHBOARD_PROVISIONER_DIR;

    const res = await request(app).post('/dfe/dashboards/restore-shipped');

    expect(res.body).toEqual({ cleared: 0, reprovisioned: false });
    expect(mockSync).not.toHaveBeenCalled();
  });

  test('a directory that is configured but absent does not reprovision', async () => {
    process.env.DASHBOARD_PROVISIONER_DIR = path.join(tmpDir, 'gone');

    const res = await request(app).post('/dfe/dashboards/restore-shipped');

    expect(res.body.reprovisioned).toBe(false);
    expect(mockSync).not.toHaveBeenCalled();
  });
});
