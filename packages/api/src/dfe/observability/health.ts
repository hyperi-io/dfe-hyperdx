// The DFE health probes, for the Node/Express API side of the stack.
//
// This is scalo's health contract expressed in Express, so the hyperdx fork
// probes the same way the Rust services do: same paths, same bodies, same
// semantics.
//
// | Endpoint | Semantics         | Fails when         | K8s action        |
// |----------|-------------------|--------------------|-------------------|
// | /livez   | process alive     | never              | kill + restart    |
// | /readyz  | ready for traffic | ready flag cleared | pull from Service |
//
// Those two are the whole surface. There are no aliases and no startup route: a
// second path meaning the same thing eventually stops meaning the same thing, and
// an alias that keeps answering 200 hides a probe still aimed at a retired name.
//
// A startupProbe targets /livez. Kubernetes suspends liveness until the startup
// probe passes, so one path gives both a generous boot budget and a tight
// liveness period without the two drifting apart.
//
// The one deviation from the Rust services, and it is forced: they host health on
// the METRICS port (9090) because scalo runs a second HTTP server. This Express
// app has one listener (the OpAMP server is separate and internal), so these ride
// the API port. Paths and bodies are unchanged, which is what the probes and the
// operators actually read.
//
// This is a NEW file - it does not modify any upstream HyperDX file. Upstream's
// own /api/health is left untouched; this is the additive scalo surface.
//
// These routes MUST be mounted ahead of the session/passport and admin-lockdown
// middleware: a probe is unauthenticated, and a health route sitting behind auth
// answers a redirect to /login, which k8s counts as SUCCESS -- the pod goes green
// while the app is face down. Keep them ahead of the auth stack in api-app.ts.

import type { Request, Response } from 'express';

export type HealthBody = { status: string };

const OK = 200;
const UNAVAILABLE = 503;

// Module-level process state: one readiness flag for the whole API process.
let ready = true;

/** Clear readiness so K8s pulls this pod from the Service (e.g. on SIGTERM drain). */
export function setReady(value: boolean): void {
  ready = value;
}

/** Current readiness, exposed for tests and diagnostics. */
export function isReady(): boolean {
  return ready;
}

/**
 * Liveness: alive, and NOTHING else.
 *
 * Never checks a downstream dependency. Mixing liveness with dependency checks is
 * the classic cascading-restart-loop bug: when Mongo or ClickHouse goes down,
 * restarting every API replica makes recovery slower, not faster. Liveness exists
 * to catch a deadlocked process -- if it can answer, it is alive.
 */
export function livez(_req: Request, res: Response): void {
  res.status(OK).json({ status: 'alive' } satisfies HealthBody);
}

/**
 * Readiness: should this pod take traffic?
 *
 * Deliberately does NOT probe a downstream dependency. The API must still serve
 * its own error states when a backend is down; gating on a backend would pull
 * every API pod from the Service the moment that backend blipped, turning one
 * degraded dependency into a total outage -- and would deadlock a cold start where
 * the app and its dependencies come up together. Readiness flips only on an
 * explicit drain (setReady(false) on SIGTERM).
 */
export function readyz(_req: Request, res: Response): void {
  if (!ready) {
    res.status(UNAVAILABLE).json({ status: 'not_ready' } satisfies HealthBody);
    return;
  }
  res.status(OK).json({ status: 'ready' } satisfies HealthBody);
}
