/**
 * A route validated through zod-express-middleware hands its handler only what
 * the schema parsed, with inherited-property keys stripped at any depth. The
 * routes here call the library the way upstream's routers do, after the swap
 * api-app.ts loads first.
 */
import '@/dfe/validated-request';

import { DashboardSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { z } from 'zod';
import { processRequest, validateRequest } from 'zod-express-middleware';

import * as dfe from '@/dfe/validated-request';

const API_APP = join(__dirname, '..', '..', 'api-app.ts');

/** One PATCH route, its handler recording what would reach the model write. */
function appFor(middleware: express.RequestHandler, path = '/dashboards/:id') {
  const write = jest.fn();
  const app = express();
  app.use(express.json());
  app.patch(path, middleware, (req, res) => {
    write(req.params, req.query, req.body);
    res.sendStatus(200);
  });
  return { app, write };
}

const patchJson = (app: express.Express, path: string, body: string) =>
  request(app).patch(path).set('Content-Type', 'application/json').send(body);

describe('api-app.ts loads the swap before any router', () => {
  test('as its first import', () => {
    const source = readFileSync(API_APP, 'utf8');
    const firstImport = source.match(/^import .*$/m)?.[0];
    expect(firstImport).toBe("import './dfe/validated-request';");
  });

  test('which replaces both library entry points', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const library = require('zod-express-middleware');
    expect(library.validateRequest).toBe(dfe.validateRequest);
    expect(library.processRequest).toBe(dfe.validateRequest);
  });
});

describe('PATCH /dashboards/:id with keys the schema does not declare', () => {
  // Typed loosely, as express's own route signature does not know `:id`.
  const params: z.ZodTypeAny = z.object({ id: z.string() });
  const middleware = validateRequest({
    params,
    body: DashboardSchema.partial(),
  });

  test('reaches the write with only the declared keys', async () => {
    const { app, write } = appFor(middleware);
    const res = await patchJson(
      app,
      '/dashboards/d1',
      JSON.stringify({
        name: 'renamed',
        team: '000000000000000000000bad',
        $set: { team: '000000000000000000000bad' },
        constructor: { prototype: { polluted: true } },
      }),
    );

    expect(res.status).toBe(200);
    expect(write).toHaveBeenCalledWith({ id: 'd1' }, {}, { name: 'renamed' });
  });

  test('still refuses an invalid body in the library shape', async () => {
    const { app, write } = appFor(middleware);
    const res = await patchJson(app, '/dashboards/d1', '{"name":7}');

    expect(res.status).toBe(400);
    expect(res.body).toEqual([
      expect.objectContaining({ type: 'Body', errors: expect.anything() }),
    ]);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('inherited-property keys inside free-form fields', () => {
  test.each([
    ['validateRequest', validateRequest],
    ['processRequest', processRequest],
  ])('are stripped at any depth through %s', async (_, validator) => {
    const { app, write } = appFor(
      validator({
        body: z.object({ meta: z.record(z.any()), list: z.array(z.any()) }),
      }),
      '/',
    );
    const res = await patchJson(
      app,
      '/',
      '{"meta":{"ok":1,"constructor":{"prototype":{"x":1}},"__proto__":{"y":1},' +
        '"deep":{"prototype":1,"keep":2}},"list":[{"constructor":1,"keep":3}]}',
    );

    expect(res.status).toBe(200);
    const body = write.mock.calls[0][2];
    expect(body).toEqual({
      meta: { ok: 1, deep: { keep: 2 } },
      list: [{ keep: 3 }],
    });
    expect(Object.prototype.hasOwnProperty.call(body.meta, '__proto__')).toBe(
      false,
    );
  });
});

describe('query strings', () => {
  test('reach the handler as parsed, without undeclared keys', async () => {
    const query: z.ZodTypeAny = z.object({ limit: z.coerce.number() });
    const { app, write } = appFor(validateRequest({ query }), '/');
    const res = await request(app).patch('/?limit=5&team=x');

    expect(res.status).toBe(200);
    expect(write.mock.calls[0][1]).toEqual({ limit: 5 });
  });
});
