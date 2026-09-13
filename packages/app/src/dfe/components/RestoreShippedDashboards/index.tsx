// Put the shipped dashboards back after someone deleted one.
//
// A delete is tombstoned so the provisioner stops re-creating it. This clears
// the team's tombstones and reprovisions inside the request, so the list is
// correct as soon as the query refetches.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import { Button, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRestore } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { hdxServer } from '@/api';

type RestoreResponse = { cleared: number; reprovisioned: boolean };

export default function RestoreShippedDashboards() {
  const queryClient = useQueryClient();

  const restore = useMutation({
    mutationFn: () =>
      hdxServer('dfe/dashboards/restore-shipped', {
        method: 'POST',
      }).json<RestoreResponse>(),
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      notifications.show({
        color: 'green',
        message: result.reprovisioned
          ? 'Shipped dashboards restored'
          : 'Nothing to restore: no shipped dashboards are configured',
      });
    },
    onError: () => {
      notifications.show({
        color: 'red',
        message: 'Could not restore the shipped dashboards',
      });
    },
  });

  return (
    <Tooltip
      label="Bring back any shipped dashboard this team deleted"
      withArrow
    >
      <Button
        variant="secondary"
        leftSection={<IconRestore size={16} />}
        loading={restore.isPending}
        onClick={() => restore.mutate()}
        data-testid="restore-shipped-dashboards-button"
      >
        Restore shipped
      </Button>
    </Tooltip>
  );
}
