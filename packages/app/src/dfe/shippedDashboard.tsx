// Shipped dashboards: read-only in the console, duplicated to get an editable copy.
//
// A dashboard the DFE release ships carries `provisioned: true` and is rewritten
// by the provisioner every minute, so the API refuses every modification. The
// page used to attempt those writes anyway and surfaced the 403 as "Unable to
// save dashboard". `useDfeDashboard` keeps upstream's `useDashboard` signature
// and swallows the write instead, so no request is made and no toast can fire.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import { useCallback } from 'react';
import { useRouter } from 'next/router';
import { Badge, Group, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLock } from '@tabler/icons-react';

import { type Dashboard, useCreateDashboard, useDashboard } from '@/dashboard';

type UseDashboardArgs = Parameters<typeof useDashboard>[0];
type UseDashboardResult = ReturnType<typeof useDashboard>;

/** True for a dashboard the DFE release owns and replaces on upgrade. */
export function isDfeManaged(
  dashboard?: Pick<Dashboard, 'provisioned'> | null,
): boolean {
  return dashboard?.provisioned === true;
}

/**
 * Upstream's `useDashboard` with every save dropped for a shipped dashboard.
 *
 * Same arguments and same result shape, plus `isDfeManaged`, so the call site
 * is a one-identifier swap.
 */
export function useDfeDashboard(
  args: UseDashboardArgs,
): UseDashboardResult & { isDfeManaged: boolean } {
  const upstream = useDashboard(args);
  const { dashboard, setDashboard: upstreamSetDashboard } = upstream;
  const managed = isDfeManaged(dashboard);

  const setDashboard = useCallback(
    (
      newDashboard: Dashboard,
      onSuccess?: VoidFunction,
      onError?: VoidFunction,
    ) => {
      if (managed) {
        return;
      }
      upstreamSetDashboard(newDashboard, onSuccess, onError);
    },
    [managed, upstreamSetDashboard],
  );

  return { ...upstream, setDashboard, isDfeManaged: managed };
}

/**
 * The create payload for a team-owned copy of a shipped dashboard.
 *
 * Fields are listed rather than spread: the fetched dashboard carries
 * `createdAt`, `updatedBy` and friends, which are the server's to set.
 * `provisioned` is absent, so the copy belongs to the team and is editable.
 */
export function shippedDashboardCopy(
  dashboard: Dashboard,
): Omit<Dashboard, 'id'> {
  return {
    name: `${dashboard.name} (copy)`,
    tiles: dashboard.tiles,
    tags: dashboard.tags ?? [],
    filters: dashboard.filters ?? [],
    savedQuery: dashboard.savedQuery ?? null,
    savedQueryLanguage: dashboard.savedQueryLanguage ?? null,
    savedFilterValues: dashboard.savedFilterValues ?? [],
    containers: dashboard.containers ?? [],
  };
}

/** Create a team-owned copy of a shipped dashboard and open it. */
export function useDuplicateShippedDashboard() {
  const createDashboard = useCreateDashboard();
  const router = useRouter();

  const duplicate = useCallback(
    (dashboard: Dashboard) => {
      createDashboard.mutate(shippedDashboardCopy(dashboard), {
        onSuccess: created => {
          router.push(`/dashboards/${created.id}`);
        },
        onError: () => {
          notifications.show({
            color: 'red',
            message: 'Could not duplicate this dashboard',
          });
        },
      });
    },
    [createDashboard, router],
  );

  return { duplicate, isPending: createDashboard.isPending };
}

/** The dashboard title, with the badge that says why nothing here can be edited. */
export function ShippedDashboardTitle({ name }: { name: string }) {
  return (
    <Group gap="xs" wrap="nowrap" data-testid="shipped-dashboard-title">
      <Title
        fw={400}
        maw={500}
        order={3}
        style={{
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {name}
      </Title>
      <Badge
        variant="light"
        color="gray"
        size="sm"
        tt="none"
        leftSection={<IconLock size={12} />}
        style={{ flexShrink: 0 }}
      >
        Shipped with DFE -- read-only. Duplicate to edit.
      </Badge>
    </Group>
  );
}
