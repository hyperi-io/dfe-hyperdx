import { useCallback, useState } from 'react';
import { HTTPError } from 'ky';
import { ChartConfig } from '@hyperdx/common-utils/dist/types';
import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { hdxServer } from '@/api';
import { DFE_UI_BASE_URL } from '@/config';
import { useDfeWriteActionProps } from '@/dfe/readOnlySession';

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

// `detail` is a string, or for a rejected request a list of `{ msg }`.
function detailText(detail: unknown): string {
  if (typeof detail === 'string') {
    return detail;
  }
  if (!Array.isArray(detail)) {
    return '';
  }
  return detail
    .flatMap(item =>
      item != null && typeof item === 'object' && typeof item.msg === 'string'
        ? [item.msg]
        : [],
    )
    .join('; ');
}

// The engine says why it refused in `message` or `detail`; ky's own names only
// the status.
export async function engineReason(err: {
  message: string;
  response: { clone: () => { json: () => Promise<unknown> } };
}): Promise<string> {
  try {
    const body: unknown = await err.response.clone().json();
    if (body != null && typeof body === 'object') {
      const message =
        'message' in body && typeof body.message === 'string'
          ? body.message
          : '';
      const reason =
        message || ('detail' in body ? detailText(body.detail) : '');
      if (reason) {
        return reason;
      }
    }
  } catch {
    // A body that is not JSON carries no reason to show.
  }
  return err.message;
}

// chartConfig follows the source picker behind a debounce, so for a moment it
// still describes the previous source. The rule is only created from a config
// that matches the source on screen.
export function isChartConfigStale(
  chartConfig: Pick<ChartConfig, 'source'> | null,
  sourceId?: string,
): boolean {
  return !!sourceId && chartConfig?.source !== sourceId;
}

export function CreateRuleFromSearch({
  chartConfig,
  savedSearchName,
  sourceId,
}: {
  chartConfig: ChartConfig | null;
  sourceId?: string;
  savedSearchName?: string | null;
}) {
  // Deliberately plain useState rather than react-query's useMutation. This
  // component is injected into upstream's DBSearchPage, and upstream tests
  // render that page behind a PARTIAL `@tanstack/react-query` mock - pulling a
  // second hook out of that module makes their pristine tests explode. Owning
  // the one-shot request state here keeps our delta invisible to them.
  const [isPending, setIsPending] = useState(false);
  // A read-only session cannot create a rule, so the action is not drawn for it.
  const writeActionProps = useDfeWriteActionProps();

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
        headers: { 'X-Requested-With': 'dfe-console' },
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
      } else if (err instanceof HTTPError && err.response.status === 502) {
        // The route reports every engine-credential failure as 502 so it never
        // trips the app's redirect-to-login on 401.
        notifications.show({
          color: 'red',
          title: 'Rule engine unreachable',
          message:
            'The DFE engine did not accept this session. Your search is unchanged.',
          autoClose: 5000,
        });
      } else {
        notifications.show({
          color: 'red',
          title: 'Failed to create rule',
          message:
            err instanceof HTTPError
              ? await engineReason(err)
              : err instanceof Error
                ? err.message
                : String(err),
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
      disabled={!chartConfig || isChartConfigStale(chartConfig, sourceId)}
      style={{ flexShrink: 0 }}
      {...writeActionProps}
    >
      Create Rule
    </Button>
  );
}
