import { useCallback, useEffect, useId, useState } from 'react';
import { ChartConfig } from '@hyperdx/common-utils/dist/types';
import {
  Button,
  Code,
  Popover,
  Stack,
  Text,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';

import { DFE_UI_BASE_URL } from '@/config';
import { useDfeWriteActionProps } from '@/dfe/readOnlySession';
import { errorResponse, refusalCopy } from '@/dfe/ruleCheck';
import { createRule, exportSql } from '@/dfe/ruleRequests';
import { useRuleCheck } from '@/dfe/useRuleCheck';

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
  // The engine is asked before Create is pressed. A refusal turns the button
  // off and is explained on hover and focus, and in full when it is clicked.
  // Nothing shows until the user acts, because a time-only search is the
  // ordinary state of the page.
  const check = useRuleCheck(
    chartConfig,
    savedSearchName,
    !isChartConfigStale(chartConfig, sourceId),
  );
  const refusal = check.state === 'refused' ? check.refusal : undefined;
  const copy = refusal ? refusalCopy(refusal) : undefined;
  const [open, setOpen] = useState(false);
  // The explanation closes on any change to the search, the time range
  // included, which the check itself ignores, and on a new answer.
  const searchKey = JSON.stringify(chartConfig);
  useEffect(() => setOpen(false), [refusal, searchKey]);
  const hintId = useId();
  // A read-only session cannot create a rule, so the action is not drawn for it.
  const writeActionProps = useDfeWriteActionProps();

  const onClick = useCallback(async () => {
    setIsPending(true);
    try {
      // Render the search to a concrete ClickHouse SELECT server-side; the
      // engine's from-hyperdx endpoint takes the expanded raw SQL.
      const { rawSql } = await exportSql(chartConfig);

      // Create the rule through the engine (rule:write enforced there). The
      // route forwards a 403 for org_viewer / missing permission.
      const rule = await createRule(rawSql, savedSearchName);

      // Open the created rule in the DFE UI.
      window.open(`${DFE_UI_BASE_URL}/rules/${rule.id}`, '_blank');
    } catch (err) {
      const response = errorResponse(err);
      if (response?.status === 403) {
        notifications.show({
          color: 'red',
          title: 'Permission denied',
          message: 'You do not have permission to create rules.',
          autoClose: 5000,
        });
      } else if (response?.status === 502) {
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
            response && err instanceof Error
              ? await engineReason({ message: err.message, response })
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
    <Popover
      opened={open && copy !== undefined}
      // onDismiss is Escape or a click outside. onClose only reports the close.
      onDismiss={() => setOpen(false)}
      position="bottom-end"
      // Clear the search bar's second row (time range, refresh, Run).
      offset={48}
      width={340}
      shadow="md"
    >
      <Popover.Target>
        <span style={{ display: 'inline-flex', flexShrink: 0 }}>
          <Tooltip
            label={copy?.summary}
            disabled={copy === undefined || open}
            events={{ hover: true, focus: true, touch: true }}
            position="bottom-end"
            // Below the second row of the search bar, as the explanation is.
            offset={48}
          >
            <Button
              data-testid="create-rule-from-search-button"
              variant="secondary"
              size="xs"
              // A refused button stays focusable and says why, so it is
              // aria-disabled rather than disabled.
              onClick={copy ? () => setOpen(value => !value) : onClick}
              loading={isPending}
              disabled={
                !chartConfig ||
                isChartConfigStale(chartConfig, sourceId) ||
                check.state === 'checking'
              }
              data-disabled={copy ? true : undefined}
              aria-disabled={copy ? true : undefined}
              aria-describedby={copy ? hintId : undefined}
              aria-expanded={copy ? open : undefined}
              // Focus stays on the button, so Escape is read here too.
              onKeyDown={event => event.key === 'Escape' && setOpen(false)}
              style={{ flexShrink: 0 }}
              {...writeActionProps}
            >
              Create Rule
            </Button>
          </Tooltip>
          {copy && (
            <VisuallyHidden id={hintId} data-testid="create-rule-precheck-hint">
              {`${copy.summary} ${copy.explanation}`.trim()}
            </VisuallyHidden>
          )}
        </span>
      </Popover.Target>
      <Popover.Dropdown data-testid="create-rule-precheck" role="status">
        {copy && (
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {copy.summary}
            </Text>
            {copy.explanation && <Text size="sm">{copy.explanation}</Text>}
            {copy.bounds.length > 0 && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Left out of the rule:
                </Text>
                {copy.bounds.map(bound => (
                  <Code key={bound} block>
                    {bound}
                  </Code>
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
