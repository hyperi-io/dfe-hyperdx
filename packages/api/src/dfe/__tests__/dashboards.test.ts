/**
 * DFE pre-canned dashboard seeding.
 *
 * Two invariants. Every built dashboard must satisfy the same schema the upstream
 * provisioner validates against, because a tile that fails that parse is dropped
 * silently at render rather than erroring. And a tenant team must never be handed
 * a dashboard whose tiles reference an otel source it does not hold.
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

import { DashboardWithoutIdSchema } from '@hyperdx/common-utils/dist/types';

import {
  dashboardsForTeam,
  SOURCE_DEFAULT,
  SOURCE_OTEL_LOGS,
  SOURCE_OTEL_METRICS,
  SourceIdsByName,
} from '@/dfe/dashboards';
import {
  buildPlatformDashboard,
  buildThroughputDashboard,
} from '@/dfe/dashboards/definitions';

// Shaped like the ObjectIds createSource mints, so anything that validates the
// reference as an id rather than a name is exercised.
const DEFAULT_ID = '6512aa000000000000000001';
const METRICS_ID = '6512aa000000000000000002';
const LOGS_ID = '6512aa000000000000000003';

function allIds(): SourceIdsByName {
  return new Map([
    [SOURCE_DEFAULT, DEFAULT_ID],
    [SOURCE_OTEL_METRICS, METRICS_ID],
    [SOURCE_OTEL_LOGS, LOGS_ID],
  ]);
}

describe('dashboard definitions', () => {
  it('the throughput dashboard parses as a provisionable dashboard', () => {
    const parsed = DashboardWithoutIdSchema.safeParse(
      buildThroughputDashboard(DEFAULT_ID),
    );
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it('the platform dashboard parses as a provisionable dashboard', () => {
    const parsed = DashboardWithoutIdSchema.safeParse(
      buildPlatformDashboard(METRICS_ID, LOGS_ID),
    );
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it('every throughput tile points at the source id it was built with', () => {
    const dashboard = buildThroughputDashboard(DEFAULT_ID);
    const sources = dashboard.tiles.map(t => t.config.source);
    expect(sources).not.toHaveLength(0);
    expect(new Set(sources)).toEqual(new Set([DEFAULT_ID]));
  });

  it('gives every tile a unique id', () => {
    const ids = buildThroughputDashboard(DEFAULT_ID).tiles.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('breaks throughput out by _org_id', () => {
    const dashboard = buildThroughputDashboard(DEFAULT_ID);
    const grouped = dashboard.tiles.filter(
      t => 'groupBy' in t.config && t.config.groupBy === '_org_id',
    );
    expect(grouped.length).toBeGreaterThan(0);
  });

  it('keeps tiles inside the 24-column grid', () => {
    for (const t of buildThroughputDashboard(DEFAULT_ID).tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(24);
    }
  });
});

describe('dashboardsForTeam', () => {
  it('gives a tenant team the throughput dashboard only', () => {
    const dashboards = dashboardsForTeam(
      new Map([[SOURCE_DEFAULT, DEFAULT_ID]]),
      false,
    );
    expect(dashboards.map(d => d.name)).toEqual(['DFE Throughput']);
  });

  it('never gives a tenant the platform dashboard even when otel ids are present', () => {
    const dashboards = dashboardsForTeam(allIds(), false);
    expect(dashboards.map(d => d.name)).toEqual(['DFE Throughput']);
  });

  it('gives the platform team both', () => {
    const dashboards = dashboardsForTeam(allIds(), true);
    expect(dashboards.map(d => d.name)).toEqual([
      'DFE Throughput',
      'DFE Platform Overview',
    ]);
  });

  it('drops the platform dashboard when an otel source is missing', () => {
    const partial: SourceIdsByName = new Map([
      [SOURCE_DEFAULT, DEFAULT_ID],
      [SOURCE_OTEL_METRICS, METRICS_ID],
    ]);
    expect(dashboardsForTeam(partial, true).map(d => d.name)).toEqual([
      'DFE Throughput',
    ]);
  });

  it('builds nothing when no sources were seeded', () => {
    expect(dashboardsForTeam(new Map(), true)).toEqual([]);
    expect(dashboardsForTeam(new Map(), false)).toEqual([]);
  });
});
