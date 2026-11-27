import { ChartConfig } from '@hyperdx/common-utils/dist/types';

import { hdxServer } from '@/api';

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
export type CreatedRule = {
  id: string;
  display_name: string;
  sanitize_summary?: Record<string, unknown>;
  warnings?: string[];
  sql_errors?: unknown[];
};

/** Render the search to a concrete ClickHouse SELECT, server-side. */
export const exportSql = (chartConfig: ChartConfig | null) =>
  hdxServer(`dfe/export-sql`, {
    method: 'POST',
    json: { chartConfig },
  }).json<ExportedSql>();

const ruleCall = (
  path: 'dfe/create-rule' | 'dfe/validate-rule',
  rawSql: string,
  savedSearchName: string | null | undefined,
) =>
  hdxServer(path, {
    method: 'POST',
    headers: { 'X-Requested-With': 'dfe-console' },
    json: {
      rawSql,
      savedSearchName: savedSearchName ?? undefined,
    },
  });

/**
 * Ask the engine for a rule from that SELECT (rule:write enforced there). Only
 * a click on Create Rule calls this.
 */
export const createRule = (
  rawSql: string,
  savedSearchName: string | null | undefined,
) => ruleCall('dfe/create-rule', rawSql, savedSearchName).json<CreatedRule>();

/**
 * Ask the engine whether that SELECT would make a rule, through the route that
 * writes nothing. It resolves when the engine would save the rule and rejects
 * with an HTTPError otherwise: 422 for a refusal, 404 or 405 from an engine
 * that predates the route.
 */
export const validateRule = (
  rawSql: string,
  savedSearchName: string | null | undefined,
) => ruleCall('dfe/validate-rule', rawSql, savedSearchName).json<unknown>();
