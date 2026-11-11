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

import { readFileSync } from 'node:fs';

import type { Request, Response } from 'express';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';

// The cgroup v2 file first, then v1, as scalo reads them
const MEMORY_USAGE_FILES = [
  '/sys/fs/cgroup/memory.current',
  '/sys/fs/cgroup/memory/memory.usage_in_bytes',
];
const MEMORY_LIMIT_FILES = [
  '/sys/fs/cgroup/memory.max',
  '/sys/fs/cgroup/memory/memory.limit_in_bytes',
];
// The v2 root cgroup has cpu.stat for the whole host but no memory.current, so only a container's own cgroup has both
const CPU_STAT_FILE = '/sys/fs/cgroup/cpu.stat';
const CONTAINER_MARKER_FILE = '/sys/fs/cgroup/memory.current';

function readText(file: string): string | undefined {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed cgroup paths, never request input
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** The byte count in the first readable cgroup file, or undefined when none holds a number, as `max` does. */
export function cgroupBytes(files: readonly string[]): number | undefined {
  for (const file of files) {
    const text = readText(file)?.trim();
    if (text === undefined) continue;
    const bytes = Number(text);
    return text !== '' && Number.isFinite(bytes) ? bytes : undefined;
  }
  return undefined;
}

/** CPU seconds every process in this container has used, or undefined outside a container's cgroup v2. */
export function cgroupCpuSeconds(
  statFile: string = CPU_STAT_FILE,
  markerFile: string = CONTAINER_MARKER_FILE,
): number | undefined {
  if (readText(markerFile) === undefined) return undefined;
  const usec = readText(statFile)?.match(/^usage_usec (\d+)$/m)?.[1];
  return usec === undefined ? undefined : Number(usec) / 1e6;
}

/** A gauge set from the cgroup at every scrape, left out when this host has no such file, as scalo does. */
function cgroupGauge(
  reg: Registry,
  name: string,
  help: string,
  files: readonly string[],
): void {
  if (cgroupBytes(files) === undefined) return;
  new Gauge({
    name,
    help,
    registers: [reg],
    collect() {
      const bytes = cgroupBytes(files);
      if (bytes !== undefined) this.set(bytes);
    },
  });
}

// One registry per process. The default collector must only ever be registered
// once -- prom-client throws on a duplicate metric name, which would turn
// /metrics into a 500 on a second build.
let registry: Registry | undefined;

function buildRegistry(): Registry {
  const reg = new Registry();
  collectDefaultMetrics({ register: reg });

  // A gauge as scalo exports it, counting every node process in the container as the memory gauges do
  reg.removeSingleMetric('process_cpu_seconds_total');
  new Gauge({
    name: 'process_cpu_seconds_total',
    help: 'Total user and system CPU time spent in seconds, by the whole container where it has its own cgroup',
    registers: [reg],
    collect() {
      const { system, user } = process.cpuUsage();
      this.set(cgroupCpuSeconds() ?? (system + user) / 1e6);
    },
  });

  cgroupGauge(
    reg,
    'container_memory_usage_bytes',
    'Container memory usage in bytes',
    MEMORY_USAGE_FILES,
  );
  cgroupGauge(
    reg,
    'container_memory_limit_bytes',
    'Container memory limit in bytes',
    MEMORY_LIMIT_FILES,
  );

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

  // scalo's start time, which the DFE engine reads uptime from
  new Gauge({
    name: 'start_time_seconds',
    help: 'Unix timestamp of process start',
    registers: [reg],
  }).set(Date.now() / 1000 - process.uptime());

  return reg;
}

function getRegistry(): Registry {
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
