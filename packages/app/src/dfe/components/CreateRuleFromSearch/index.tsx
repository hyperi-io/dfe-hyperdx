import { useCallback, useState } from 'react';
import { HTTPError } from 'ky';
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

// The engine's RuleFromHyperdxResponse, forwarded verbatim by /dfe/create-rule.
type CreatedRule = {
  id: string;
  display_name: string;
  sanitize_summary?: Record<string, unknown>;
  warnings?: string[];
  sql_errors?: unknown[];
};

export function CreateRuleFromSearch({
  chartConfig,
  savedSearchName,
}: {
  chartConfig: ChartConfig | null;
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
      // Render the search to a concrete ClickHouse SELECT server-side; the
      // engine's from-hyperdx endpoint takes the expanded raw SQL.
      const { rawSql } = await hdxServer(`dfe/export-sql`, {
        method: 'POST',
        json: { chartConfig },
      }).json<ExportedSql>();

      // Create the rule through the engine (rule:write enforced there). The
      // route forwards a 403 for org_viewer / missing permission.
      const rule = await hdxServer(`dfe/create-rule`, {
        method: 'POST',
        json: {
          rawSql,
          savedSearchName: savedSearchName ?? undefined,
        },
      }).json<CreatedRule>();

      // Open the created rule in the DFE UI.
      window.open(`${DFE_UI_BASE_URL}/rules/${rule.id}`, '_blank');
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 403) {
        notifications.show({
          color: 'red',
          title: 'Permission denied',
          message: 'You do not have permission to create rules.',
          autoClose: 5000,
        });
      } else {
        notifications.show({
          color: 'red',
          title: 'Failed to create rule',
          message: err instanceof Error ? err.message : String(err),
          autoClose: 5000,
        });
      }
    } finally {
      setIsPending(false);
    }
  }, [chartConfig, savedSearchName]);

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
