/**
 * The badge on a shipped dashboard is read in the console, so it carries
 * punctuation a reader recognises: a typed `--` shows as two hyphens.
 */

import { screen } from '@testing-library/react';

import { ShippedDashboardTitle } from '@/dfe/shippedDashboard';

describe('ShippedDashboardTitle', () => {
  it('names the dashboard and says why it cannot be edited', () => {
    renderWithMantine(<ShippedDashboardTitle name="DFE Throughput" />);

    expect(
      screen.getByRole('heading', { name: 'DFE Throughput' }),
    ).toBeVisible();
    expect(
      screen.getByText('Shipped with DFE, read-only. Duplicate to edit.'),
    ).toBeVisible();
  });

  it('shows no typed double hyphen', () => {
    renderWithMantine(<ShippedDashboardTitle name="DFE Throughput" />);

    expect(
      screen.getByTestId('shipped-dashboard-title').textContent,
    ).not.toContain('--');
  });
});
