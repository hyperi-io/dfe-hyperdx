// DFE Query Export Router
// Renders SQL from a HyperDX chart config or saved search for use
// as a DFE Rule. Returns both the structured config and the rendered SQL.
//
// This is a NEW file — it does not modify any upstream HyperDX files.

import { parameterizedQueryToSql } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import {
  ChartConfigWithOptDateRange,
  SavedChartConfigSchema,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { Api500Error } from '@/utils/errors';
import logger from '@/utils/logger';

const router = express.Router();

const exportSqlBodySchema = z.object({
  // The chart config to render — same shape as a dashboard tile config
  chartConfig: SavedChartConfigSchema,
  // Optional date range for the query (millisecond timestamps)
  startTime: z.number().optional(),
  endTime: z.number().optional(),
});

/**
 * POST /dfe/export-sql
 *
 * Renders SQL from a chart config for use as a DFE Rule.
 *
 * Request body:
 *   - chartConfig: SavedChartConfig (same structure as dashboard tiles)
 *   - startTime?: number (ms timestamp, optional)
 *   - endTime?: number (ms timestamp, optional)
 *
 * Response:
 *   - sql: string (formatted, executable SQL)
 *   - config: SavedChartConfig (original config, for structured consumption)
 *   - source: { name, kind, tableName, connection }
 */
router.post(
  '/export-sql',
  validateRequest({ body: exportSqlBodySchema }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { chartConfig, startTime, endTime } = req.body;

      // Resolve the source to get table and connection info. In 2.29+ the chart
      // config's `source` is optional (SavedChartConfig is a union), so guard it.
      if (!chartConfig.source) {
        return res
          .status(400)
          .json({ error: 'chartConfig.source is required for SQL export' });
      }
      const source = await getSource(teamId.toString(), chartConfig.source);
      if (!source) {
        return res.status(404).json({ error: 'Source not found' });
      }

      // Resolve the connection for ClickHouse access. source.connection is a
      // connection-id string in 2.29+.
      const connectionId = String(source.connection);
      const connection = await getConnectionById(
        teamId.toString(),
        connectionId,
        false,
      );

      if (connection == null) {
        throw new Api500Error('Invalid connection');
      }

      // Build the full chart config with optional date range.
      // renderChartConfig requires connection and from; add them from the resolved source.
      // `where` only exists on the builder (search/select) chart-config variant,
      // not the raw-SQL / PromQL variants (2.29 made SavedChartConfig a union).
      const existingWhere =
        'where' in chartConfig && chartConfig.where
          ? (chartConfig.where as string)
          : undefined;

      const fullConfig = {
        ...chartConfig,
        connection: connectionId,
        ...(startTime && endTime
          ? {
              dateRange: [new Date(startTime), new Date(endTime)],
            }
          : {}),
        // Adjust the config to use the org_id and source_table_name placeholders
        // required by the DFE control plane
        from: {
          databaseName: '{{org_id}}',
          tableName: '{{source_table_name}}',
        },
        where: existingWhere
          ? `${existingWhere} AND {timestamp_condition}`
          : '{timestamp_condition}',
        // When where is empty, the effective where is only {timestamp_condition}
        // (a SQL placeholder). It must not be parsed as Lucene—the Lucene parser
        // expects {a TO b} range syntax and fails on {timestamp_condition}.
        ...(existingWhere ? {} : { whereLanguage: 'sql' as const }),
      } as ChartConfigWithOptDateRange;

      // Create a ClickHouse client to fetch metadata
      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });

      const metadata = getMetadata(clickhouseClient);
      const querySettings = source.querySettings;

      // Render the chart config to SQL
      const chSql = await renderChartConfig(
        fullConfig,
        metadata,
        querySettings,
      );

      // Format the SQL for readability
      const rawSql = parameterizedQueryToSql(chSql);
      let formattedSql: string;
      try {
        formattedSql = format(rawSql);
      } catch {
        // If formatting fails, return raw SQL
        formattedSql = rawSql;
      }

      return res.json({
        sql: formattedSql,
        rawSql,
        config: chartConfig,
        source: {
          name: source.name,
          kind: source.kind,
          from: source.from,
          connection: connectionId,
        },
      });
    } catch (err) {
      logger.error({ err }, 'DFE: export-sql failed');
      next(err);
    }
  },
);

export default router;
