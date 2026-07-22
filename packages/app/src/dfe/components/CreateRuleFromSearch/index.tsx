import { useCallback, useState } from 'react';
import { ChartConfig } from '@hyperdx/common-utils/dist/types';
import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { hdxServer } from '@/api';
import { DFE_UI_BASE_URL } from '@/config';

export type ExportedSql = {
  sql: string;
  rawSql: string;
  config: ChartConfig;
  source: {
    name: string;
    kind: string;
    from: string;
    connection: string;
  };
};

/**
 * Hand the exported SQL to the DFE UI's rule builder in a new tab.
 *
 * The tab is not listening the instant `window.open` returns, so repeat the
 * post until it acknowledges, then stop. The 15s ceiling bounds the retry for
 * the case where the user closes the tab or never loads it.
 */
export function handOffToRuleBuilder(payload: Record<string, unknown>): void {
  const target = window.open(`${DFE_UI_BASE_URL}/rules/create`, '_blank');
  if (!target) return;

  const message = { type: 'CREATE_RULE_FROM_SEARCH', payload };

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
}

export function CreateRuleFromSearch({
  chartConfig,
  savedSearchId,
  savedSearchName,
}: {
  chartConfig: ChartConfig | null;
  savedSearchId?: string | null;
  savedSearchName?: string | null;
}) {
  // Deliberately plain useState rather than react-query's useMutation. This
  // component is injected into upstream's DBSearchPage, and upstream tests
  // render that page behind a PARTIAL `@tanstack/react-query` mock - pulling a
  // second hook out of that module makes their pristine tests explode. Owning
  // the one-shot request state here keeps our delta invisible to them.
  const [isPending, setIsPending] = useState(false);

  const onClick = useCallback(async () => {
    setIsPending(true);
    try {
      const data = await hdxServer(`dfe/export-sql`, {
        method: 'POST',
        json: { chartConfig },
      }).json<ExportedSql>();

      handOffToRuleBuilder({
        ...data,
        savedSearchId,
        savedSearchName,
        chartConfig,
      });
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Failed to create rule',
        message: err instanceof Error ? err.message : String(err),
        autoClose: 5000,
      });
    } finally {
      setIsPending(false);
    }
  }, [chartConfig, savedSearchId, savedSearchName]);

  return (
    <Button
      data-testid="create-rule-from-search-button"
      variant="secondary"
      size="xs"
      onClick={onClick}
      loading={isPending}
      disabled={!chartConfig}
      style={{ flexShrink: 0 }}
    >
      Create Rule
    </Button>
  );
}
