/**
 * The restore control sits in the dashboards header beside Import and New
 * Dashboard. At 800px it pushed the page title out from under itself, so below
 * the `sm` breakpoint it keeps only its icon.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';

import RestoreShippedDashboards from '@/dfe/components/RestoreShippedDashboards';

describe('RestoreShippedDashboards', () => {
  beforeEach(() => {
    renderWithMantine(
      <QueryClientProvider client={new QueryClient()}>
        <RestoreShippedDashboards />
      </QueryClientProvider>,
    );
  });

  it('shows the labelled button from the sm breakpoint up', () => {
    const labelled = screen.getByTestId('restore-shipped-dashboards-button');

    expect(labelled).toHaveTextContent('Restore shipped');
    expect(labelled).toHaveClass('mantine-visible-from-sm');
  });

  it('shows a named icon-only button below it', () => {
    const iconOnly = screen.getByTestId(
      'restore-shipped-dashboards-icon-button',
    );

    expect(iconOnly).toHaveAccessibleName('Restore shipped');
    expect(iconOnly).toHaveClass('mantine-hidden-from-sm');
  });
});
