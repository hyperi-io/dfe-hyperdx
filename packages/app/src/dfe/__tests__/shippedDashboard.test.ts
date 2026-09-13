/**
 * Shipped dashboards are read-only, and a duplicate is the way to edit one.
 *
 * Two things have to hold. The predicate reads `provisioned` and nothing else,
 * because that is the only field the API marks a release-owned dashboard with.
 * And the copy must be TEAM-owned and free of the server's own fields, or the
 * duplicate lands back under the provisioner and is overwritten within a minute.
 */

import type { Dashboard } from '@/dashboard';
import { isDfeManaged, shippedDashboardCopy } from '@/dfe/shippedDashboard';

const SHIPPED: Dashboard = {
  id: '507f1f77bcf86cd799439011',
  name: 'DFE Overview',
  tiles: [{ id: 'tile-1', x: 0, y: 0, w: 4, h: 3, config: {} as never }],
  tags: ['dfe'],
  filters: [{ id: 'f1' } as never],
  savedQuery: 'level:error',
  savedQueryLanguage: 'lucene',
  savedFilterValues: [{ type: 'sql', condition: '1=1' } as never],
  containers: [{ id: 'c1' } as never],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  createdBy: { email: 'someone@example.com' },
  provisioned: true,
};

describe('isDfeManaged', () => {
  test('a provisioned dashboard is managed', () => {
    expect(isDfeManaged(SHIPPED)).toBe(true);
  });

  test('a team dashboard is not', () => {
    expect(isDfeManaged({ ...SHIPPED, provisioned: false })).toBe(false);
  });

  test('a dashboard the API answered without the field is not', () => {
    expect(isDfeManaged({})).toBe(false);
  });

  test('nothing loaded yet is not managed, so the page renders normally', () => {
    expect(isDfeManaged(undefined)).toBe(false);
    expect(isDfeManaged(null)).toBe(false);
  });
});

describe('shippedDashboardCopy', () => {
  const copy = shippedDashboardCopy(SHIPPED);

  test('names the copy so it is distinguishable in the list', () => {
    expect(copy.name).toBe('DFE Overview (copy)');
  });

  test('carries the tiles, tags, filters and saved query across', () => {
    expect(copy.tiles).toEqual(SHIPPED.tiles);
    expect(copy.tags).toEqual(['dfe']);
    expect(copy.filters).toEqual(SHIPPED.filters);
    expect(copy.savedQuery).toBe('level:error');
    expect(copy.savedQueryLanguage).toBe('lucene');
    expect(copy.savedFilterValues).toEqual(SHIPPED.savedFilterValues);
    expect(copy.containers).toEqual(SHIPPED.containers);
  });

  test('is team-owned: no provisioned flag reaches the create call', () => {
    expect(copy).not.toHaveProperty('provisioned');
    expect(isDfeManaged(copy)).toBe(false);
  });

  test('leaves the server-owned fields off the payload', () => {
    expect(copy).not.toHaveProperty('id');
    expect(copy).not.toHaveProperty('createdAt');
    expect(copy).not.toHaveProperty('updatedAt');
    expect(copy).not.toHaveProperty('createdBy');
  });

  test('a dashboard with no optional fields still yields a valid payload', () => {
    const bare = shippedDashboardCopy({
      id: 'x',
      name: 'Bare',
      tiles: [],
      tags: [],
      provisioned: true,
    });

    expect(bare).toEqual({
      name: 'Bare (copy)',
      tiles: [],
      tags: [],
      filters: [],
      savedQuery: null,
      savedQueryLanguage: null,
      savedFilterValues: [],
      containers: [],
    });
  });
});
