// DFE sources control surface, for the engine's service principal only.
//
// The engine deploys a DFE source, and every human team needs a HyperDX source
// over the table it just made. The team-scoped /sources surface cannot do that -
// it writes to the caller's team, and the service principal's team holds no
// connection and no humans. These routes fan the write out across every team
// instead, each over that team's own connection.
//
// Engine-only: the listing spans teams, so it is not a read a human may make.
// api-app.ts mounts it behind requireServicePrincipal.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  isOwnedName,
  listByTeam,
  removeEverywhere,
  upsertEverywhere,
} from '@/dfe/controllers/dfe-sources';
import logger from '@/utils/logger';

const router = express.Router();

// Source names come from DFE source definitions, which are table names.
const nameSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
});

// The engine's SourceSchemaNoId body minus `name` (in the path) and
// `connection` (resolved per team). Passthrough: the fork does not own the spec,
// so a field the engine adds must reach the source document unaltered.
const specSchema = z
  .object({
    kind: z.string().min(1),
    from: z.object({
      databaseName: z.string().min(1),
      tableName: z.string().min(1),
    }),
    timestampValueExpression: z.string().min(1),
  })
  .passthrough();

/**
 * PUT /dfe/sources/:name
 *
 * Register the source and create or replace it on every team that has a
 * connection. Idempotent: a re-deploy replaces the source it wrote before.
 *
 * Response: { name, written: [team names], skipped: [team names] }
 */
router.put(
  '/:name',
  validateRequest({ params: nameSchema, body: specSchema }),
  async (req, res, next) => {
    try {
      const { name } = req.params;
      if (!(await isOwnedName(name))) {
        // A seeded source of that name is already on a team; replacing it would
        // retarget the landing or hunts view of every team at once.
        return res.status(409).json({
          error: `'${name}' is a seeded HyperDX source and is not the engine's to write`,
        });
      }

      const { written, skipped } = await upsertEverywhere(name, req.body);
      logger.info(
        { source: name, written: written.length, skipped: skipped.length },
        'DFE: source written to every team',
      );
      return res.json({ name, written, skipped });
    } catch (err) {
      logger.error({ err }, 'DFE: source upsert failed');
      next(err);
    }
  },
);

/**
 * DELETE /dfe/sources/:name
 *
 * Drop the source from the manifest and from every team holding it. A name the
 * manifest never carried removes nothing, so a delete can never take a seeded
 * source with it.
 *
 * Response: { name, removed: [team names] }
 */
router.delete(
  '/:name',
  validateRequest({ params: nameSchema }),
  async (req, res, next) => {
    try {
      const { name } = req.params;
      const { removed } = await removeEverywhere(name);
      logger.info(
        { source: name, removed: removed.length },
        'DFE: source removed from every team',
      );
      return res.json({ name, removed });
    } catch (err) {
      logger.error({ err }, 'DFE: source removal failed');
      next(err);
    }
  },
);

/**
 * GET /dfe/sources
 *
 * Every team and the registered DFE sources it holds - what the engine reports
 * back so an operator can see where a source actually landed.
 *
 * Response: { teams: [{ team, teamName, sources: [{ id, name, from }] }] }
 */
router.get('/', async (_req, res, next) => {
  try {
    return res.json({ teams: await listByTeam() });
  } catch (err) {
    logger.error({ err }, 'DFE: source listing failed');
    next(err);
  }
});

export default router;
