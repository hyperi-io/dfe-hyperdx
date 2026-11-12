/**
 * DFE scalo observability surface: /livez, /readyz, /metrics.
 *
 * Handlers are exercised on a minimal Express app so the suite stays hermetic --
 * it does not boot the full api-app (session store, passport, Mongo). The routes
 * are plain GET handlers, so a bare app that mounts them is faithful to how
 * api-app.ts wires them, minus the middleware they deliberately sit ahead of.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- cgroup fixtures in a temp dir */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import request from 'supertest';

import { isReady, livez, readyz, setReady } from '@/dfe/observability/health';
import {
  cgroupBytes,
  cgroupCpuSeconds,
  metricsHandler,
} from '@/dfe/observability/metrics';

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
  test('serves Prometheus text with the process_, nodejs_, info and start time families', async () => {
    const app = appWith('/metrics', metricsHandler);

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    // Default collector families (cross-platform members of each), plus the
    // hand-added gauges that mirror the Rust services' info and start time.
    // A gauge, as scalo exports it, since the engine reads CPU only from gauges
    expect(res.text).toMatch(/^# TYPE process_cpu_seconds_total gauge$/m);
    expect(
      Number(res.text.match(/^process_cpu_seconds_total (\S+)$/m)?.[1]),
    ).toBeGreaterThan(0);
    expect(res.text).not.toMatch(/^container_memory_limit_bytes 0$/m);
    expect(res.text).toMatch(/nodejs_/);
    expect(res.text).toMatch(/^info\{/m);
    const started = Number(res.text.match(/^start_time_seconds (\S+)$/m)?.[1]);
    expect(started).toBeLessThanOrEqual(Date.now() / 1000);
    expect(started).toBeGreaterThan(Date.now() / 1000 - process.uptime() - 5);
  });
});

describe('cgroup readers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cgroup-'));
  const file = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const missing = join(dir, 'missing');
  const stat = (text: string) =>
    file('cpu.stat', `${text}\nuser_usec 1\nsystem_usec 2\n`);

  test.each([
    {
      files: () => [stat('usage_usec 2500000'), file('memory.current', '1\n')],
      expected: 2.5,
      when: "the container's cgroup holds usage_usec",
    },
    {
      files: () => [stat('usage_usec 2500000'), missing],
      expected: undefined,
      when: 'the cgroup has no memory.current, as the host root has none',
    },
    {
      files: () => [stat('nr_periods 0'), file('memory.current', '1\n')],
      expected: undefined,
      when: 'cpu.stat has no usage_usec line',
    },
    {
      files: () => [missing, file('memory.current', '1\n')],
      expected: undefined,
      when: 'there is no cpu.stat',
    },
  ])('cgroupCpuSeconds reads $expected when $when', ({ expected, files }) => {
    const [statFile, markerFile] = files();
    expect(cgroupCpuSeconds(statFile, markerFile)).toBe(expected);
  });

  test.each([
    {
      files: () => [file('v2-number', '536870912\n')],
      expected: 536870912,
      when: 'the v2 file holds a number',
    },
    {
      files: () => [file('v2-max', 'max\n'), file('v1-under-max', '1024\n')],
      expected: undefined,
      when: 'the v2 limit is max',
    },
    {
      files: () => [missing, file('v1-number', '2048\n')],
      expected: 2048,
      when: 'only the v1 file exists',
    },
    {
      files: () => [file('empty', '')],
      expected: undefined,
      when: 'the file is empty',
    },
    { files: () => [missing], expected: undefined, when: 'no file exists' },
  ])('cgroupBytes reads $expected when $when', ({ expected, files }) => {
    expect(cgroupBytes(files())).toBe(expected);
  });
});
