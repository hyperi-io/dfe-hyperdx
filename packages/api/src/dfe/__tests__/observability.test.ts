/**
 * DFE scalo observability surface: /livez, /readyz, /metrics.
 *
 * Handlers are exercised on a minimal Express app so the suite stays hermetic --
 * it does not boot the full api-app (session store, passport, Mongo). The routes
 * are plain GET handlers, so a bare app that mounts them is faithful to how
 * api-app.ts wires them, minus the middleware they deliberately sit ahead of.
 */
import express from 'express';
import request from 'supertest';

import { isReady, livez, readyz, setReady } from '@/dfe/observability/health';
import { metricsHandler } from '@/dfe/observability/metrics';

function appWith(path: string, handler: express.RequestHandler) {
  const app = express();
  app.get(path, handler);
  return app;
}

describe('/livez', () => {
  test('always 200 { status: alive }, regardless of readiness', async () => {
    const app = appWith('/livez', livez);

    setReady(true);
    const whenReady = await request(app).get('/livez');
    expect(whenReady.status).toBe(200);
    expect(whenReady.body).toEqual({ status: 'alive' });

    // Liveness never reflects the readiness flag -- a drained pod is still alive.
    setReady(false);
    const whenDraining = await request(app).get('/livez');
    expect(whenDraining.status).toBe(200);
    expect(whenDraining.body).toEqual({ status: 'alive' });

    setReady(true);
  });
});

describe('/readyz', () => {
  afterEach(() => setReady(true));

  test('200 { status: ready } while the ready flag is set', async () => {
    const app = appWith('/readyz', readyz);
    setReady(true);

    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  test('503 { status: not_ready } after setReady(false)', async () => {
    const app = appWith('/readyz', readyz);

    setReady(false);
    expect(isReady()).toBe(false);

    const res = await request(app).get('/readyz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready' });
  });
});

describe('/metrics', () => {
  test('serves Prometheus text with the process_, nodejs_ and info families', async () => {
    const app = appWith('/metrics', metricsHandler);

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    // Default collector families (cross-platform members of each), plus the
    // hand-added info gauge that mirrors the Rust services' info{version,commit}.
    expect(res.text).toMatch(/process_cpu_seconds_total/);
    expect(res.text).toMatch(/nodejs_/);
    expect(res.text).toMatch(/^info\{/m);
  });
});
