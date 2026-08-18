// Prometheus metrics for the Node/Express API side of the stack, deliberately
// shaped like the Rust services' output so one dashboard and one scrape config
// cover everything.
//
// prom-client's default collector already emits the same process_* family scalo
// does (process_cpu_seconds_total, process_resident_memory_bytes,
// process_open_fds, process_start_time_seconds), plus the nodejs_* family --
// event-loop lag, GC, heap -- which is the Node equivalent of what the Rust
// services report about their runtime. The `info` gauge is added by hand to match
// theirs (info{version,commit} 1).
//
// This is a NEW file - it does not modify any upstream HyperDX file.

import type { Request, Response } from 'express';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';

// One registry per process. The default collector must only ever be registered
// once -- prom-client throws on a duplicate metric name, which would turn
// /metrics into a 500 on a second build.
let registry: Registry | undefined;

function buildRegistry(): Registry {
  const reg = new Registry();
  collectDefaultMetrics({ register: reg });

  new Gauge({
    name: 'info',
    help: 'Application info for service discovery',
    labelNames: ['version', 'commit'],
    registers: [reg],
  }).set(
    {
      version: process.env.CODE_VERSION ?? 'unknown',
      commit: process.env.GIT_COMMIT ?? 'unknown',
    },
    1,
  );

  return reg;
}

export function getRegistry(): Registry {
  registry ??= buildRegistry();
  return registry;
}

/** Serve the Prometheus text exposition for a scrape. */
export async function metricsHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const reg = getRegistry();
  res.setHeader('Content-Type', reg.contentType);
  res.send(await reg.metrics());
}
