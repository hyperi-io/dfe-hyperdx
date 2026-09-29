/**
 * The command palette must offer no preset dashboard: this fork ships none of
 * upstream's preset pages, so every one of those entries would 404.
 */
import { renderHook } from '@testing-library/react';

import { useSpotlightActions } from '@/Spotlights';

jest.mock('next/router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/theme/ThemeProvider', () => ({
  useBrandDisplayName: () => 'DFE',
  useLogomark: () => null,
}));

// Upstream only offers the Kubernetes preset with this flag on.
jest.mock('@/config', () => ({ IS_K8S_DASHBOARD_ENABLED: true }));

jest.mock('@/dashboard', () => ({
  useDashboards: () => ({ data: [] }),
}));

jest.mock('@/savedSearch', () => ({
  useSavedSearches: () => ({ data: [] }),
}));

describe('command palette - preset dashboards', () => {
  const ids = () =>
    renderHook(() => useSpotlightActions()).result.current.actions.map(
      action => action.id,
    );

  it('offers none of the preset dashboards', () => {
    expect(ids().filter(id => id?.startsWith('preset-'))).toEqual([]);
  });

  it('still offers the menu entries', () => {
    expect(ids()).toEqual(
      expect.arrayContaining(['search', 'chart-explorer', 'new-dashboard']),
    );
  });
});
