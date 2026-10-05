import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';

import RestoreShippedDashboards from '@/dfe/components/RestoreShippedDashboards';
import DfeThroughputHeadline from '@/dfe/components/ThroughputHeadline';
import { QueryClientOnly } from '@/dfe/QueryClientOnly';

describe('QueryClientOnly', () => {
  it('renders its children under a QueryClientProvider', () => {
    renderWithMantine(
      <QueryClientProvider client={new QueryClient()}>
        <QueryClientOnly>
          <span>inside</span>
        </QueryClientOnly>
      </QueryClientProvider>,
    );

    expect(screen.getByText('inside')).toBeInTheDocument();
  });

  it('renders nothing without one', () => {
    renderWithMantine(
      <QueryClientOnly>
        <span>inside</span>
      </QueryClientOnly>,
    );

    expect(screen.queryByText('inside')).not.toBeInTheDocument();
  });

  // Upstream's DashboardsListPage test mounts the page with no QueryClient.
  it('keeps the components injected into the dashboards list from throwing', () => {
    expect(() => {
      renderWithMantine(
        <>
          <RestoreShippedDashboards />
          <DfeThroughputHeadline />
        </>,
      );
    }).not.toThrow();
    expect(
      screen.queryByTestId('restore-shipped-dashboards-button'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('dfe-throughput')).not.toBeInTheDocument();
  });
});
