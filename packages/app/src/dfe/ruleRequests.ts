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

const createRuleCall = (
  rawSql: string,
  savedSearchName: string | null | undefined,
  searchParams?: Record<string, string>,
) =>
  hdxServer(`dfe/create-rule`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'dfe-console' },
    searchParams,
    json: {
      rawSql,
      savedSearchName: savedSearchName ?? undefined,
    },
  });

/** Ask the engine for a rule from that SELECT (rule:write enforced there). */
export const createRule = (
  rawSql: string,
  savedSearchName: string | null | undefined,
) => createRuleCall(rawSql, savedSearchName).json<CreatedRule>();

/**
 * Ask the engine whether that SELECT would make a rule, writing nothing. The
 * answer is the status: 200 when the engine honoured the dry run, 201 when an
 * engine that predates it saved a rule. A refusal is thrown as an HTTPError.
 */
export const dryRunRule = async (
  rawSql: string,
  savedSearchName: string | null | undefined,
) =>
  (await createRuleCall(rawSql, savedSearchName, { dry_run: 'true' })).status;
