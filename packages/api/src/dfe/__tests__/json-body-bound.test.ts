/**
 * A JSON body wider than the bound is refused before any route's schema runs.
 *
 * zod 3 walks every array element and record key even after a `.max()` fails,
 * so one wide body is enough to exhaust the API's heap. Carried as
 * security/patches/0004-json-body-bound.patch, which mounts the guard in
 * api-app.ts. The routes are rebuilt here around the schemas they validate
 * with, because api-app.ts opens a Mongo session store at import, so the
 * source-text assertion is what ties these tests to the shipped mount.
 */
import {
  DashboardWithoutIdSchema,
  PinnedFiltersValueSchema,
  SavedChartConfigSchema,
  SavedSearchSchema,
  SourceSchema,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { z } from 'zod';

import {
  boundJsonBody,
  MAX_JSON_ARRAY_ELEMENTS,
  MAX_JSON_OBJECT_MEMBERS,
} from '@/dfe/middleware/json-body-bound';

const API_APP = join(__dirname, '..', '..', 'api-app.ts');
const SHIPPED = join(
  __dirname,
  'fixtures',
  'shipped-dashboards',
  'kept-one.json',
);

const SERIES = {
  aggFn: 'count',
  aggCondition: '',
  aggConditionLanguage: 'lucene',
  valueExpression: '',
};

const PinnedFiltersBodySchema = z.object({
  source: z.string(),
  fields: z.array(z.string().max(1024)).max(100),
  filters: PinnedFiltersValueSchema,
});

/** An app shaped like api-app.ts, whose one route counts its schema runs. */
function appFor(schema: z.ZodTypeAny, guarded = true) {
  const parse = jest.fn((body: unknown) => schema.safeParse(body));
  const app = express();
  app.use(express.json({ limit: '32mb', inflate: false }));
  if (guarded) {
    app.use(boundJsonBody);
  }
  app.post('/', (req, res) => {
    const result = parse(req.body);
    res.status(result.success ? 200 : 400).json({ valid: result.success });
  });
  return { app, parse };
}

const repeat = (element: string, count: number) =>
  Array(count).fill(element).join(',');

const records = (count: number) =>
  Array.from({ length: count }, (_, i) => `"k${i}":["v"]`).join(',');

describe('api-app.ts mounts the bound', () => {
  const source = readFileSync(API_APP, 'utf8');

  test('after the JSON parser and before every router', () => {
    const json = source.indexOf('app.use(express.json(');
    const bound = source.indexOf('app.use(boundJsonBody);');
    const firstRouter = source.indexOf("app.use('/', routers.rootRouter);");

    expect(json).toBeGreaterThan(-1);
    expect(bound).toBeGreaterThan(json);
    expect(firstRouter).toBeGreaterThan(bound);
  });
});

describe('the 400,000-tile body that exhausts the heap unguarded', () => {
  const body = `{"name":"x","tags":[],"tiles":[${repeat('{}', 400_000)}]}`;

  test('is refused with 413 in under a second, and zod never runs', async () => {
    const { app, parse } = appFor(DashboardWithoutIdSchema);
    const started = Date.now();
    const res = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(body);
    const elapsed = Date.now() - started;

    expect(res.status).toBe(413);
    expect(res.body.error).toContain(
      `${MAX_JSON_ARRAY_ELEMENTS} array elements`,
    );
    expect(parse).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(1000);
  });

  test('reaches zod without the guard, which is what the guard stops', async () => {
    const { app, parse } = appFor(DashboardWithoutIdSchema, false);
    const wide = `{"name":"x","tags":[],"tiles":[${repeat('{}', MAX_JSON_ARRAY_ELEMENTS + 1)}]}`;
    const res = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(wide);

    expect(res.status).toBe(400);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe('real dashboards pass', () => {
  test('a shipped dashboard is admitted and validates', async () => {
    const { app, parse } = appFor(DashboardWithoutIdSchema);
    const res = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(readFileSync(SHIPPED, 'utf8'));

    expect(res.status).toBe(200);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test("upstream's 500-tile cap, two series a tile, is admitted and validates", async () => {
    const tiles = Array.from({ length: 500 }, (_, i) => ({
      id: `tile-${i}`,
      x: 0,
      y: i,
      w: 6,
      h: 2,
      config: {
        name: `Chart ${i}`,
        source: 'main',
        displayType: 'line',
        select: [SERIES, SERIES],
        where: '',
        whereLanguage: 'lucene',
      },
    }));
    const { app, parse } = appFor(DashboardWithoutIdSchema);
    const res = await request(app)
      .post('/')
      .send({ name: 'Wide', tags: ['dfe'], tiles });

    expect(res.status).toBe(200);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

const ROUTE_CLASSES: ReadonlyArray<{
  name: string;
  schema: z.ZodTypeAny;
  over: string;
  within: string;
  bound: string;
}> = [
  {
    name: 'POST and PATCH /dashboards, through a nested select',
    schema: DashboardWithoutIdSchema,
    over: `{"name":"x","tags":[],"tiles":[{"id":"a","x":0,"y":0,"w":1,"h":1,"config":{"select":[${repeat('{}', MAX_JSON_ARRAY_ELEMENTS)}]}}]}`,
    within: `{"name":"x","tags":[],"tiles":[{"id":"a","x":0,"y":0,"w":1,"h":1,"config":{"select":[${repeat('{}', 100)}]}}]}`,
    bound: 'array elements',
  },
  {
    name: 'POST and PATCH /saved-search, through alerts',
    schema: SavedSearchSchema,
    over: `{"name":"x","select":"","where":"","whereLanguage":"sql","source":"s","tags":[],"alerts":[${repeat('{}', MAX_JSON_ARRAY_ELEMENTS + 1)}]}`,
    within: `{"name":"x","select":"","where":"","whereLanguage":"sql","source":"s","tags":[],"alerts":[${repeat('{}', 10)}]}`,
    bound: 'array elements',
  },
  {
    name: 'PUT /pinned-filters, through the filters record',
    schema: PinnedFiltersBodySchema,
    over: `{"source":"s","fields":[],"filters":{${records(MAX_JSON_OBJECT_MEMBERS)}}}`,
    within: `{"source":"s","fields":[],"filters":{${records(100)}}}`,
    bound: 'object members',
  },
  {
    name: 'POST /dfe/export-sql, through the chart config',
    schema: z.object({ chartConfig: SavedChartConfigSchema }),
    over: `{"chartConfig":{"source":"s","select":[${repeat('{}', MAX_JSON_ARRAY_ELEMENTS + 1)}]}}`,
    within: `{"chartConfig":{"source":"s","select":[${repeat('{}', 10)}]}}`,
    bound: 'array elements',
  },
  {
    name: 'engine-only writes such as /sources, through materialized views',
    schema: SourceSchema,
    over: `{"kind":"log","name":"x","materializedViews":[${repeat('{}', MAX_JSON_ARRAY_ELEMENTS + 1)}]}`,
    within: `{"kind":"log","name":"x","materializedViews":[${repeat('{}', 10)}]}`,
    bound: 'array elements',
  },
];

describe.each(ROUTE_CLASSES)('$name', route => {
  test('is refused with 413 over the bound, before its schema runs', async () => {
    const { app, parse } = appFor(route.schema);
    const res = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(route.over);

    expect(res.status).toBe(413);
    expect(res.body.error).toContain(route.bound);
    expect(parse).not.toHaveBeenCalled();
  });

  test('reaches its schema within the bound', async () => {
    const { app, parse } = appFor(route.schema);
    await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(route.within);

    expect(parse).toHaveBeenCalledTimes(1);
  });
});
