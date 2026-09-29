/**
 * Name -> id resolution for provisioned dashboards.
 *
 * A dashboard file written by hand has no way to know a team's source ObjectIds,
 * so it names sources instead. `syncDashboards` used to write those names into
 * `config.source`, where an id belongs, and the tile rendered dead. These tests
 * cover the resolution and the two failure postures: pass through unchanged by
 * default (upstream's behaviour, and what upstream's own integration fixture
 * relies on), or skip the dashboard when the caller asks for strictness.
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

import type { DashboardWithoutId } from '@hyperdx/common-utils/dist/types';

import { resolveDashboardRefs } from '@/tasks/provisionDashboards';
import logger from '@/utils/logger';

const SOURCES = [
  { id: '507f1f77bcf86cd799439011', name: 'default' },
  { id: '507f1f77bcf86cd799439012', name: 'otel_metrics' },
];

const CONNECTIONS = [{ id: '507f1f77bcf86cd799439021', name: 'platform' }];

function dashboard(
  tileConfigs: Record<string, unknown>[],
  filters?: Record<string, unknown>[],
): DashboardWithoutId {
  return {
    name: 'Test',
    tags: [],
    tiles: tileConfigs.map((config, i) => ({
      id: `tile-${i}`,
      x: 0,
      y: 0,
      w: 4,
      h: 3,
      config,
    })),
    ...(filters ? { filters } : {}),
  } as unknown as DashboardWithoutId;
}

function sourceOf(resolved: DashboardWithoutId | undefined, index = 0) {
  return (resolved?.tiles[index].config as { source?: string }).source;
}

describe('resolveDashboardRefs', () => {
  test('a source NAME is rewritten to its id', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: 'default' }]),
      SOURCES,
      CONNECTIONS,
    );

    expect(sourceOf(resolved)).toBe('507f1f77bcf86cd799439011');
  });

  test('matching is case-insensitive, like the import UI', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: 'OTEL_Metrics' }]),
      SOURCES,
      CONNECTIONS,
    );

    expect(sourceOf(resolved)).toBe('507f1f77bcf86cd799439012');
  });

  test('an id is left alone, so id-based files keep working', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: '507f1f77bcf86cd799439012' }]),
      SOURCES,
      CONNECTIONS,
    );

    expect(sourceOf(resolved)).toBe('507f1f77bcf86cd799439012');
  });

  test('a connection name is rewritten too', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: 'default', connection: 'platform' }]),
      SOURCES,
      CONNECTIONS,
    );

    expect(
      (resolved?.tiles[0].config as { connection?: string }).connection,
    ).toBe('507f1f77bcf86cd799439021');
  });

  test('every tile is resolved, not just the first', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: 'default' }, { source: 'otel_metrics' }]),
      SOURCES,
      CONNECTIONS,
    );

    expect(sourceOf(resolved, 0)).toBe('507f1f77bcf86cd799439011');
    expect(sourceOf(resolved, 1)).toBe('507f1f77bcf86cd799439012');
  });

  test('dashboard filters carry a source reference and are resolved as well', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: 'default' }], [{ source: 'otel_metrics' }]),
      SOURCES,
      CONNECTIONS,
    );

    expect(
      (resolved?.filters?.[0] as unknown as { source: string }).source,
    ).toBe('507f1f77bcf86cd799439012');
  });

  test('the input is not mutated', () => {
    const input = dashboard([{ source: 'default' }]);

    resolveDashboardRefs(input, SOURCES, CONNECTIONS);

    expect((input.tiles[0].config as { source?: string }).source).toBe(
      'default',
    );
  });

  test('an unresolvable name passes through unchanged by default', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: 'nope' }]),
      SOURCES,
      CONNECTIONS,
    );

    expect(resolved).toBeDefined();
    expect(sourceOf(resolved)).toBe('nope');
  });

  test('under requireResolvable the whole dashboard is skipped', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: 'default' }, { source: 'otel_metrics' }]),
      [SOURCES[0]],
      CONNECTIONS,
      true,
    );

    expect(resolved).toBeUndefined();
  });

  test('a requireResolvable skip is not a warning', () => {
    // Every tick skips the platform dashboards for every team without the
    // platform sources, so a warning here floods the log once a minute.
    jest.mocked(logger.warn).mockClear();

    resolveDashboardRefs(dashboard([{ source: 'otel_metrics' }]), [], [], true);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ unresolved: 'source:otel_metrics' }),
      expect.any(String),
    );
  });

  test('an unresolved ref written with dead tiles is still a warning', () => {
    jest.mocked(logger.warn).mockClear();

    resolveDashboardRefs(dashboard([{ source: 'nope' }]), SOURCES, CONNECTIONS);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ unresolved: 'source:nope' }),
      expect.any(String),
    );
  });

  test('requireResolvable keeps a dashboard whose refs all resolve', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ source: 'default' }]),
      SOURCES,
      CONNECTIONS,
      true,
    );

    expect(sourceOf(resolved)).toBe('507f1f77bcf86cd799439011');
  });

  test('a tile with no source (markdown) is untouched', () => {
    const resolved = resolveDashboardRefs(
      dashboard([{ markdown: '# hello' }]),
      SOURCES,
      CONNECTIONS,
      true,
    );

    expect(resolved).toBeDefined();
    expect(sourceOf(resolved)).toBeUndefined();
  });
});
