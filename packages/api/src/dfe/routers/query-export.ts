// DFE Query Export Router
// Renders SQL from a HyperDX chart config or saved search for use
// as a DFE Rule. Returns both the structured config and the rendered SQL.
//
// This is a NEW file -- it does not modify any upstream HyperDX files.

import { parameterizedQueryToSql } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
import {
  ChartConfigWithOptDateRange,
  SavedChartConfigSchema,
} from '@hyperdx/common-utils/dist/types';
import express, { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { engineOrigin } from '@/dfe/controllers/org-connection';
import { extractToken } from '@/dfe/middleware/jwt-verify';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { Api500Error } from '@/utils/errors';
import logger from '@/utils/logger';

const router = express.Router();

const exportSqlBodySchema = z.object({
  // The chart config to render -- same shape as a dashboard tile config
  chartConfig: SavedChartConfigSchema,
  // Optional date range for the query (millisecond timestamps)
  startTime: z.number().optional(),
  endTime: z.number().optional(),
});

// The expanded rule input the UI hands us -- the same fields CreateRuleFromSearch
// gathered for export-sql, i.e. the rendered rawSql plus the saved-search metadata.
// Field names mirror what the UI holds (camelCase); we translate to the engine's
// snake_case RuleFromHyperdxRequest below.
const createRuleBodySchema = z.object({
  rawSql: z.string().min(1),
  savedSearchName: z.string().optional(),
  severity: z.string().optional(),
  hunt_name: z.string().optional(),
  source: z.string().optional(),
});

// Bound the wait on the engine so a slow/unreachable control plane fails the
// request instead of hanging the client. Matches org-connection's ceiling.
const ENGINE_TIMEOUT_MS = 5000;

// renderChartConfig's expression regexes run in time quadratic in their input
// and the API accepts 32 MB bodies, so the export body is capped at a size whose
// worst case holds the event loop, and every team with it, under half a second.
export const MAX_EXPORT_SQL_BODY_CHARS = 16 * 1024;

/** 413 an export body too large to render without stalling the process. */
function limitExportBody(req: Request, res: Response, next: NextFunction) {
  if (JSON.stringify(req.body ?? null).length > MAX_EXPORT_SQL_BODY_CHARS) {
    return res.status(413).json({
      error: `The chart config is too large to export as a rule (over ${MAX_EXPORT_SQL_BODY_CHARS} characters).`,
    });
  }
  return next();
}

/**
 * POST /dfe/export-sql
 *
 * Renders SQL from a chart config for use as a DFE Rule: the query the view
 * runs, against its source's own table and with every filter it carries.
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
  limitExportBody,
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

      // Create a ClickHouse client to fetch metadata
      const clickhouseClient = new ClickhouseClient({
        host: connection.host,
        username: connection.username,
        password: connection.password,
      });

      const metadata = getMetadata(clickhouseClient);
      const querySettings = source.querySettings;

      // renderChartConfig requires connection and from; both come from the
      // resolved source, so the rule scans the table the view searched.
      const fullConfig = {
        ...chartConfig,
        connection: connectionId,
        ...(startTime && endTime
          ? {
              dateRange: [new Date(startTime), new Date(endTime)],
            }
          : {}),
        from: source.from,
      } as ChartConfigWithOptDateRange;

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

/**
 * POST /dfe/create-rule
 *
 * Creates a DFE hunt rule from an expanded HyperDX saved search by forwarding to
 * the engine's POST /api/v1/rules/from-hyperdx. The engine sanitises the SQL,
 * creates the rule, and returns its id. The route is a thin authenticated proxy:
 * it carries the caller's engine token so the engine's rule:write RBAC applies
 * (org_viewer lacks the grant -> 403), and forwards the engine's status + body
 * unchanged so that 403 (and any 4xx) surfaces to the client.
 *
 * Request body:
 *   - rawSql: string (the expanded ClickHouse SELECT)
 *   - savedSearchName?: string
 *   - severity?: string (low|medium|high|critical; engine defaults to medium)
 *   - hunt_name?: string
 *   - source?: string
 *
 * Response: the engine's RuleFromHyperdxResponse JSON, including the new rule id.
 */
router.post(
  '/create-rule',
  validateRequest({ body: createRuleBodySchema }),
  async (req, res, next) => {
    try {
      const token = extractToken(req);
      if (!token) {
        // Not 401: the HyperDX session is valid and only the engine credential
        // is missing, and the app redirects to /login on any 401.
        return res
          .status(502)
          .json({ error: 'No DFE engine credential on this session' });
      }

      const origin = engineOrigin();
      if (!origin) {
        throw new Api500Error('Engine origin is not configured');
      }

      const { rawSql, savedSearchName, severity, hunt_name, source } = req.body;

      const engineResp = await fetch(`${origin}/api/v1/rules/from-hyperdx`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw_sql: rawSql,
          saved_search_name: savedSearchName,
          severity,
          hunt_name,
          source,
        }),
        signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
      });

      // Forward the engine's status and JSON body verbatim so RBAC failures
      // (403 for org_viewer / missing rule:write) and validation errors reach
      // the client unchanged. A non-JSON body degrades to a plain error object.
      const bodyText = await engineResp.text();
      let payload: unknown;
      try {
        payload = bodyText ? JSON.parse(bodyText) : {};
      } catch {
        payload = { error: bodyText || 'Engine returned a non-JSON response' };
      }

      if (!engineResp.ok) {
        logger.warn(
          { status: engineResp.status },
          'DFE: engine rule creation refused',
        );
      }

      // An engine 401 becomes 502 for the same reason a missing token does; the
      // engine's status is kept in the body so the cause is not lost.
      if (engineResp.status === 401) {
        return res.status(502).json({
          error: 'The DFE engine rejected this session credential',
          engineStatus: 401,
        });
      }

      return res.status(engineResp.status).json(payload);
    } catch (err) {
      logger.error({ err }, 'DFE: create-rule failed');
      next(err);
    }
  },
);

export default router;
