import { MetricsDataType, SourceKind } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';

import DfeThroughputHeadline from '@/dfe/components/ThroughputHeadline';

// The data hooks are mocked below, so the client only satisfies the guard.
function renderHeadline() {
  return renderWithMantine(
    <QueryClientProvider client={new QueryClient()}>
      <DfeThroughputHeadline />
    </QueryClientProvider>,
  );
}

const mockUseSources = jest.fn();
jest.mock('@/source', () => ({
  useSources: () => mockUseSources(),
}));

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

const mockParseRelativeTimeQuery = jest.fn();
jest.mock('@/timeQuery', () => ({
  parseRelativeTimeQuery: (interval: number) =>
    mockParseRelativeTimeQuery(interval),
}));

// recharts measures its container, which jsdom cannot do.
jest.mock('@/components/Sparkline', () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));

const otelMetrics = {
  id: 'm1',
  name: 'otel_metrics',
  kind: SourceKind.Metric,
  connection: 'c1',
  from: { databaseName: 'dfe', tableName: '' },
  timestampValueExpression: 'TimeUnix',
  resourceAttributesExpression: 'ResourceAttributes',
  metricTables: { [MetricsDataType.Sum]: 'otel_metrics_sum' },
};

// The column names renderChartConfig gives an `increase` over a sum metric.
const VALUE = 'increase(rows_inserted_total)';
const meta = [
  { name: VALUE, type: 'Float64' },
  { name: '__hdx_time_bucket', type: 'DateTime' },
];

describe('DfeThroughputHeadline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParseRelativeTimeQuery.mockReturnValue([
      new Date('2026-09-29T00:00:30Z'),
      new Date('2026-09-29T00:15:30Z'),
    ]);
    mockUseSources.mockReturnValue({ data: [otelMetrics] });
  });

  it('renders nothing for a team without the self-monitoring source', () => {
    mockUseSources.mockReturnValue({
      data: [{ ...otelMetrics, id: 'main', name: 'main', kind: 'log' }],
    });
    mockUseQueriedChartConfig.mockReturnValue({ data: undefined });

    renderHeadline();

    expect(screen.queryByTestId('dfe-throughput')).not.toBeInTheDocument();
    expect(mockUseQueriedChartConfig).not.toHaveBeenCalled();
  });

  it('says no data yet on a fresh deployment, never an error', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: { data: [], meta, rows: 0 },
      isLoading: false,
      isError: false,
    });

    renderHeadline();

    expect(screen.getByText('DFE throughput')).toBeInTheDocument();
    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.queryByTestId('dfe-throughput-rate')).not.toBeInTheDocument();
  });

  it('shows a quiet line rather than an error box when the query fails', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderHeadline();

    expect(
      screen.getByText('Throughput is unavailable right now'),
    ).toBeInTheDocument();
  });

  it('shows events a second over the complete minutes', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        meta,
        rows: 3,
        data: [
          { __hdx_time_bucket: '2026-09-29T00:13:00Z', [VALUE]: 60000 },
          { __hdx_time_bucket: '2026-09-29T00:14:00Z', [VALUE]: 84000 },
          // In progress at 00:15:30, so left out.
          { __hdx_time_bucket: '2026-09-29T00:15:00Z', [VALUE]: 10 },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderHeadline();

    // 144,000 rows over two complete minutes; the suffix is locale-dependent.
    const expected = new Intl.NumberFormat(undefined, {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(1200);
    expect(screen.getByTestId('dfe-throughput-rate')).toHaveTextContent(
      expected,
    );
    expect(screen.getByText('events/s')).toBeInTheDocument();
    expect(screen.getByTestId('sparkline')).toBeInTheDocument();
  });

  it('queries the loader counter through the metric source', () => {
    mockUseQueriedChartConfig.mockReturnValue({ data: undefined });

    renderHeadline();

    const [config] = mockUseQueriedChartConfig.mock.calls[0];
    expect(config.source).toBe('m1');
    expect(config.from).toEqual({
      databaseName: 'dfe',
      tableName: 'otel_metrics_sum',
    });
    expect(config.select[0]).toMatchObject({
      aggFn: 'increase',
      metricName: 'rows_inserted_total',
    });
  });
});
