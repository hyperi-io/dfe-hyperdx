/**
 * The api-app body-parser mounts refuse a compressed request body.
 *
 * GHSA-27r3-jxmh-p828: body-parser 1.20.6 leaves the decompression stream it
 * created piped with no error listener, so a late decoder error is thrown
 * uncaught and ends the process. These three mounts run before routing and
 * before the engine token check, so they carry the unauthenticated vector.
 * `inflate: false` refuses the request in contentstream() before that stream
 * exists. Carried as security/patches/0003-body-parser-no-inflate.patch until
 * the pin to body-parser ^1.20.9 can install.
 *
 * The PromQL router's own urlencoded parser sits behind these on the same app,
 * so it never reads a raw body, and the last block below asserts it. The OpAMP
 * listener is a separate app and keeps inflating -- see the patch header.
 *
 * The mounts are rebuilt here with the options the patched source uses rather
 * than imported, because api-app.ts opens a Mongo session store at import. The
 * option objects are asserted against that source below, so a mount that loses
 * `inflate: false` fails here.
 */
import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { gzipSync } from 'zlib';

const API_APP = join(__dirname, '..', '..', 'api-app.ts');

const MOUNTS: ReadonlyArray<{
  name: string;
  declaration: string;
  parser: () => express.RequestHandler;
  contentType: string;
  body: string;
}> = [
  {
    name: 'express.json',
    declaration: "app.use(express.json({ limit: '32mb', inflate: false }));",
    parser: () => express.json({ limit: '32mb', inflate: false }),
    contentType: 'application/json',
    body: '{"a":1}',
  },
  {
    name: 'express.text',
    declaration: "app.use(express.text({ limit: '32mb', inflate: false }));",
    parser: () => express.text({ limit: '32mb', inflate: false }),
    contentType: 'text/plain',
    body: 'hello',
  },
  {
    name: 'express.urlencoded',
    declaration:
      "app.use(express.urlencoded({ extended: false, limit: '32mb', inflate: false }));",
    parser: () =>
      express.urlencoded({ extended: false, limit: '32mb', inflate: false }),
    contentType: 'application/x-www-form-urlencoded',
    body: 'a=1',
  },
];

function appWith(parser: express.RequestHandler) {
  const app = express();
  app.post('/', parser, (_req, res) => {
    res.status(200).json({ parsed: true });
  });
  return app;
}

describe.each(MOUNTS)('api-app $name', mount => {
  test('the mount in the shipped source declares inflate: false', () => {
    const source = readFileSync(API_APP, 'utf8');
    expect(source).toContain(mount.declaration);
  });

  test('415s a gzip-encoded body instead of decompressing it', async () => {
    const res = await request(appWith(mount.parser()))
      .post('/')
      .set('Content-Type', mount.contentType)
      .set('Content-Encoding', 'gzip')
      .send(gzipSync(Buffer.from(mount.body)));

    expect(res.status).toBe(415);
  });

  test('415s a deflate-encoded body as well', async () => {
    const res = await request(appWith(mount.parser()))
      .post('/')
      .set('Content-Type', mount.contentType)
      .set('Content-Encoding', 'deflate')
      .send(gzipSync(Buffer.from(mount.body)));

    expect(res.status).toBe(415);
  });

  test('still parses an uncompressed body', async () => {
    const res = await request(appWith(mount.parser()))
      .post('/')
      .set('Content-Type', mount.contentType)
      .send(mount.body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ parsed: true });
  });
});

describe('the PromQL router parser behind the api-app mounts', () => {
  const urlencoded = MOUNTS[2];

  test('is mounted after the api-app urlencoded parser in the shipped source', () => {
    const source = readFileSync(API_APP, 'utf8');
    const outer = source.indexOf(urlencoded.declaration);

    expect(outer).toBeGreaterThan(-1);
    expect(source.indexOf("app.use('/v1/prometheus'")).toBeGreaterThan(outer);
  });

  test('never reads a raw body, so it never inflates one', async () => {
    const promqlParser = express.urlencoded({ extended: true });
    let rawBodies = 0;
    const router = express.Router();
    router.use((req, res, next) => {
      if (!(req as express.Request & { _body?: boolean })._body) rawBodies += 1;
      promqlParser(req, res, next);
    });
    router.post('/query', (_req, res) => {
      res.status(200).json({ parsed: true });
    });
    const app = express();
    app.use(urlencoded.parser());
    app.use('/v1/prometheus', router);

    const gzipped = await request(app)
      .post('/v1/prometheus/query')
      .set('Content-Type', urlencoded.contentType)
      .set('Content-Encoding', 'gzip')
      .send(gzipSync(Buffer.from(urlencoded.body)));
    const plain = await request(app)
      .post('/v1/prometheus/query')
      .set('Content-Type', urlencoded.contentType)
      .send(urlencoded.body);

    expect(gzipped.status).toBe(415);
    expect(plain.status).toBe(200);
    expect(rawBodies).toBe(0);
  });
});
