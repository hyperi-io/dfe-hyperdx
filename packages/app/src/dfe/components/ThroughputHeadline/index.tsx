// DFE throughput figure for the dashboards list, counting what dfe/throughput.ts defines.

import { useEffect, useMemo, useState } from 'react';
import { TMetricSource } from '@hyperdx/common-utils/dist/types';
import { Box, Card, Group, Skeleton, Stack, Text } from '@mantine/core';

import {
  convertToTimeChartConfig,
  formatResponseForTimeChart,
} from '@/ChartUtils';
import { sparklinePointsFromGraphResults } from '@/components/NumberTileBackgroundChart';
import { Sparkline } from '@/components/Sparkline';
import {
  findThroughputSource,
  summariseThroughput,
  THROUGHPUT_WINDOW_MS,
  throughputChartConfig,
} from '@/dfe/throughput';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSources } from '@/source';
import { parseRelativeTimeQuery } from '@/timeQuery';
import { getColorFromCSSToken } from '@/utils';

const REFRESH_MS = 60 * 1000;
const WINDOW_MINUTES = THROUGHPUT_WINDOW_MS / 60 / 1000;

const RATE_FORMAT = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function currentWindow(): [Date, Date] {
  const [start, end] = parseRelativeTimeQuery(THROUGHPUT_WINDOW_MS);
  return [start, end];
}

function ThroughputFigure({ source }: { source: TMetricSource }) {
  const [dateRange, setDateRange] = useState(currentWindow);

  useEffect(() => {
    const timer = setInterval(() => setDateRange(currentWindow()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const config = useMemo(
    () => convertToTimeChartConfig(throughputChartConfig(source, dateRange)),
    [source, dateRange],
  );

  const { data, isLoading, isError } = useQueriedChartConfig(config, {
    placeholderData: prev => prev,
    queryKey: ['dfe-throughput', config],
  });

  const summary = useMemo(() => {
    if (data == null) return undefined;
    try {
      const { graphResults, timestampColumn, lineData } =
        formatResponseForTimeChart({
          currentPeriodResponse: data,
          dateRange: config.dateRange,
          granularity: config.granularity,
          generateEmptyBuckets: false,
          source,
        });
      const points = sparklinePointsFromGraphResults(
        graphResults,
        timestampColumn?.name,
        lineData[0]?.dataKey,
      );
      return summariseThroughput(points, dateRange[1].getTime() / 1000);
    } catch {
      // A response with no timestamp or value column has nothing to report.
      return undefined;
    }
  }, [data, config, source, dateRange]);

  if (summary) {
    return (
      <Card withBorder padding="lg" radius="sm" mb="sm">
        <Group justify="space-between" gap="md">
          <Stack gap={2}>
            <Group gap={6} align="baseline" wrap="nowrap">
              <Text
                fz={32}
                fw={600}
                lh={1.1}
                style={{ fontVariantNumeric: 'tabular-nums' }}
                data-testid="dfe-throughput-rate"
              >
                {RATE_FORMAT.format(summary.perSecond)}
              </Text>
              <Text size="sm" c="dimmed">
                events/s
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              Written to ClickHouse, averaged over the last {WINDOW_MINUTES}{' '}
              minutes
            </Text>
          </Stack>
          <Box w={{ base: '100%', sm: 240 }} h={48} aria-hidden>
            <Sparkline
              points={summary.points}
              type="area"
              color={getColorFromCSSToken('chart-blue')}
            />
          </Box>
        </Group>
      </Card>
    );
  }

  return (
    <Card withBorder padding="lg" radius="sm" mb="sm">
      {isLoading ? (
        <Skeleton h={48} />
      ) : (
        <Stack gap={2} data-testid="dfe-throughput-empty">
          <Text fw={500}>
            {isError ? 'Throughput is unavailable right now' : 'No data yet'}
          </Text>
          <Text size="xs" c="dimmed">
            {isError
              ? 'The self-monitoring metrics could not be read.'
              : 'Appears once DFE starts writing events to ClickHouse.'}
          </Text>
        </Stack>
      )}
    </Card>
  );
}

/**
 * Renders nothing for a team without the self-monitoring metric source, so a
 * tenant team never sees operator telemetry.
 */
export default function DfeThroughputHeadline() {
  const { data: sources } = useSources();
  const source = findThroughputSource(sources);
  if (source === undefined) return null;

  return (
    <section data-testid="dfe-throughput">
      <Text fw={500} size="sm" c="dimmed" mb="sm">
        DFE throughput
      </Text>
      <ThroughputFigure source={source} />
    </section>
  );
}
