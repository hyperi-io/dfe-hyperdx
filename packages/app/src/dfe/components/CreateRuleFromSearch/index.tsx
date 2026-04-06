import { ChartConfig } from '@hyperdx/common-utils/dist/types';
import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';

import { hdxServer } from '@/api';
import { DFE_UI_BASE_URL } from '@/config';

export function CreateRuleFromSearch({
  chartConfig,
  savedSearchId,
  savedSearchName,
}: {
  chartConfig: ChartConfig | null;
  savedSearchId?: string | null;
  savedSearchName?: string | null;
}) {
  const exportSql = useMutation({
    mutationFn: async () => {
      return hdxServer(`dfe/export-sql`, {
        method: 'POST',
        json: {
          chartConfig,
        },
      }).json<{
        sql: string;
        rawSql: string;
        config: ChartConfig;
        source: {
          name: string;
          kind: string;
          from: string;
          connection: string;
        };
      }>();
    },
    onSuccess: async data => {
      const target = window.open(`${DFE_UI_BASE_URL}/rules/create`, '_blank');
      if (!target) return;

      const message = {
        type: 'CREATE_RULE_FROM_SEARCH',
        payload: {
          ...data,
          savedSearchId,
          savedSearchName,
          chartConfig,
        },
      };

      // Retry until the new tab acknowledges — it may not be ready to receive
      // messages the moment window.open returns.
      const interval = setInterval(() => {
        target.postMessage(message, DFE_UI_BASE_URL);
      }, 300);

      const cleanup = () => {
        clearInterval(interval);
        window.removeEventListener('message', onAck);
      };

      const onAck = (event: MessageEvent) => {
        if (
          event.origin === DFE_UI_BASE_URL &&
          event.data?.type === 'CREATE_RULE_ACK'
        ) {
          cleanup();
        }
      };

      window.addEventListener('message', onAck);
      setTimeout(cleanup, 15_000);
    },
    onError: (err: Error) => {
      notifications.show({
        color: 'red',
        title: 'Failed to create rule',
        message: err.message,
        autoClose: 5000,
      });
    },
  });

  return (
    <Button
      data-testid="create-rule-from-search-button"
      variant="secondary"
      size="xs"
      onClick={() => exportSql.mutate()}
      loading={exportSql.isPending}
      disabled={!chartConfig}
      style={{ flexShrink: 0 }}
    >
      Create Rule
    </Button>
  );
}
