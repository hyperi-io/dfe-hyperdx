/**
 * DFE e2e config -- upstream's, run against the system Chrome.
 *
 * A separate file rather than an edit to upstream's playwright.config.ts,
 * because an in-place edit to a pristine upstream file is permanent conflict
 * surface for `git rerere`. Mirrors packages/app/jest.dfe.config.js.
 *
 * Playwright 1.57.0 ships no bundled Chromium for Ubuntu 26.04 -- `playwright
 * install chromium` refuses outright -- so the pinned revision can never be
 * fetched on this host. `channel: 'chrome'` uses the Chrome already installed
 * instead, which is what DFE runs e2e against anyway.
 *
 * Everything else is upstream's, including the webServer and project list, so
 * this stays a one-line delta as that config changes.
 *
 *   make dev-e2e FILE=<name> ARGS="--config=playwright.dfe.config.ts"
 */
import { defineConfig } from '@playwright/test';

import base from './playwright.config';

const USE_FULLSTACK = process.env.E2E_FULLSTACK === 'true';

/**
 * Upstream allows 3 minutes for `yarn build && yarn start`. A DFE dev host
 * spends most of that on the build alone -- 58s of TypeScript then 68s of
 * webpack, measured -- and times out before the server ever listens. Override
 * with E2E_APP_SERVER_TIMEOUT_MS.
 */
const SERVER_TIMEOUT_MS = Number(
  process.env.E2E_APP_SERVER_TIMEOUT_MS ?? 10 * 60 * 1000,
);

const withTimeout = <T extends { timeout?: number }>(server: T): T => ({
  ...server,
  timeout: SERVER_TIMEOUT_MS,
});

export default defineConfig({
  ...base,
  // Global setup launches a browser directly, so it needs the channel too.
  ...(USE_FULLSTACK
    ? { globalSetup: require.resolve('./tests/e2e/dfe-global-setup-chrome') }
    : {}),
  webServer: Array.isArray(base.webServer)
    ? base.webServer.map(withTimeout)
    : base.webServer && withTimeout(base.webServer),
  projects: (base.projects ?? []).map(project => ({
    ...project,
    use: { ...project.use, channel: 'chrome' },
  })),
});
