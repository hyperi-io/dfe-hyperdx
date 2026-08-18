// Mount the DFE scalo observability surface on the Express app: the two health
// probes (/livez, /readyz) and the Prometheus scrape (/metrics).
//
// These are mounted BEFORE the session/passport and admin-lockdown middleware in
// api-app.ts: probes and scrapes are unauthenticated and must not hit passport or
// isUserAuthenticated. See health.ts for why a health route behind auth is worse
// than no route at all.
//
// The SIGTERM drain hook lives here rather than in upstream's server.ts: that
// file is pristine upstream (not on the fork conflict surface), so the readiness
// flip is wired from this new dfe/ module instead. A plain SIGTERM listener
// coexists with http-graceful-shutdown's own handler -- Node runs every listener
// -- so readyz flips to 503 the instant the signal arrives, ahead of the drain.
//
// This is a NEW file - it does not modify any upstream HyperDX file.

import type { Application } from 'express';

import { livez, readyz, setReady } from '@/dfe/observability/health';
import { metricsHandler } from '@/dfe/observability/metrics';

let drainHookInstalled = false;

/** Flip readiness to draining on SIGTERM. Guarded so re-imports don't stack listeners. */
function installDrainHook(): void {
  if (drainHookInstalled) {
    return;
  }
  drainHookInstalled = true;
  process.on('SIGTERM', () => {
    setReady(false);
  });
}

export function mountObservability(app: Application): void {
  app.get('/livez', livez);
  app.get('/readyz', readyz);
  app.get('/metrics', metricsHandler);
  installDrainHook();
}
