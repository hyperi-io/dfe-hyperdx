/**
 * The api resolves a body-parser that detaches its decompression stream.
 *
 * GHSA-27r3-jxmh-p828: body-parser before 1.20.9 leaves the decompression
 * stream it creates piped with no error listener, so a late decoder error is
 * thrown uncaught and ends the process. Express 4 declares `body-parser ~1.20.3`,
 * so the fix arrives through the `body-parser` entry in security/overrides.yaml
 * and this test fails when that pin is lost.
 */
import express from 'express';
import { createRequire } from 'module';
import request from 'supertest';
import { gzipSync } from 'zlib';

function bodyParserVersion(): string {
  const fromExpress = createRequire(require.resolve('express'));
  return fromExpress('body-parser/package.json').version;
}

function atLeast(version: string, major: number, minor: number, patch: number) {
  const [maj, min, pat] = version.split('.').map(Number);
  if (maj !== major) return maj > major;
  if (min !== minor) return min > minor;
  return pat >= patch;
}

describe('body-parser behind express', () => {
  test('resolves 1.20.9 or later', () => {
    expect(atLeast(bodyParserVersion(), 1, 20, 9)).toBe(true);
  });

  test('still inflates a gzip-encoded JSON body', async () => {
    const app = express();
    app.use(express.json());
    app.post('/', (req, res) => {
      res.status(200).json(req.body);
    });

    const res = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .serialize(raw => raw)
      .send(gzipSync(Buffer.from('{"a":1}')));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ a: 1 });
  });
});
