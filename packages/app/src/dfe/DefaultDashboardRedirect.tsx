// DFE default-dashboard landing.
//
// dfe-ui cannot link straight to the seeded dashboard: provisioned ids are
// per-team ObjectIds, so there is no stable id to embed in another repo. This
// route resolves the caller's own team's DFE Throughput dashboard and redirects,
// giving dfe-ui one deployment-independent path to point `/observe` at.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Center, Loader, Stack, Text } from '@mantine/core';

import { useDashboards } from '@/dashboard';

// Must match the name built in the api package
// (dfe/dashboards/definitions.ts buildThroughputDashboard).
const DFE_DEFAULT_DASHBOARD_NAME = 'DFE Throughput';

export default function DefaultDashboardRedirect() {
  const router = useRouter();
  const { data: dashboards, isLoading, isError } = useDashboards();

  useEffect(() => {
    if (isLoading || !dashboards) {
      return;
    }

    const target = dashboards.find(d => d.name === DFE_DEFAULT_DASHBOARD_NAME);

    // Falling back to the dashboard list rather than 404ing: a deployment whose
    // seeding has not run yet should still land somewhere useful.
    const href = target ? `/dashboards/${target.id}` : '/dashboards/list';

    // The embed query (embed=1, theme) is what keeps the iframe chromeless, so
    // it has to survive the redirect.
    void router.replace({ pathname: href, query: router.query });
  }, [dashboards, isLoading, router]);

  if (isError) {
    return (
      <Center h="100vh">
        <Text size="sm" c="dimmed">
          Could not load dashboards.
        </Text>
      </Center>
    );
  }

  return (
    <Center h="100vh">
      <Stack align="center" gap="xs">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          Opening {DFE_DEFAULT_DASHBOARD_NAME}...
        </Text>
      </Stack>
    </Center>
  );
}
