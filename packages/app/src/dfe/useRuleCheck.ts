/**
 * DFE: ask the engine whether the search on screen would make a valid rule.
 *
 * Plain state rather than react-query: DBSearchPage renders the component that
 * calls this, and upstream's tests render that page behind a PARTIAL
 * `@tanstack/react-query` mock.
 */
import { useEffect, useState } from 'react';
import { HTTPError } from 'ky';
import { ChartConfig } from '@hyperdx/common-utils/dist/types';

import { parseRefusal, RuleCheck } from '@/dfe/ruleCheck';
import { dryRunRule, exportSql } from '@/dfe/ruleRequests';

// chartConfig already follows the search bar behind a debounce, so this only
// absorbs the source picker settling.
const CHECK_DELAY_MS = 300;

// An engine that predates the dry run ignores it and saves the rule, so the
// first 201 ends the pre-check for the session rather than saving one per edit.
let engineHonoursDryRun = true;

async function check(
  chartConfig: ChartConfig,
  savedSearchName: string | null | undefined,
): Promise<RuleCheck> {
  if (!engineHonoursDryRun) {
    return { state: 'unavailable' };
  }
  try {
    const { rawSql } = await exportSql(chartConfig);
    if ((await dryRunRule(rawSql, savedSearchName)) !== 200) {
      engineHonoursDryRun = false;
      return { state: 'unavailable' };
    }
    return { state: 'valid' };
  } catch (err) {
    if (err instanceof HTTPError && err.response.status === 422) {
      try {
        const refusal = parseRefusal(await err.response.clone().json());
        if (refusal) {
          return { state: 'refused', refusal };
        }
      } catch {
        // A body that is not JSON is not a refusal the engine made.
      }
    }
    return { state: 'unavailable' };
  }
}

export function useRuleCheck(
  chartConfig: ChartConfig | null,
  savedSearchName: string | null | undefined,
  enabled: boolean,
): RuleCheck {
  const [result, setResult] = useState<RuleCheck>({ state: 'idle' });
  // The export ignores the time range, so a new range is not a new question.
  const key = chartConfig
    ? JSON.stringify({ ...chartConfig, dateRange: undefined })
    : '';

  useEffect(() => {
    if (!chartConfig || !enabled) {
      setResult({ state: 'idle' });
      return;
    }
    let live = true;
    setResult({ state: 'checking' });
    const timer = setTimeout(async () => {
      const answer = await check(chartConfig, savedSearchName);
      if (live) {
        setResult(answer);
      }
    }, CHECK_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // chartConfig is read through `key`, which changes when its content does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, savedSearchName, enabled]);

  return result;
}

/** Test seam: forget that an engine ignored the dry run. */
export function resetRuleCheck(): void {
  engineHonoursDryRun = true;
}
