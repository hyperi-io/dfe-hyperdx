/**
 * DFE e2e global setup: upstream's, with browser launches pointed at Chrome.
 *
 * Playwright 1.57.0 ships no bundled Chromium for Ubuntu 26.04, so the pinned
 * revision cannot be fetched on a DFE dev host. `channel: 'chrome'` in
 * playwright.dfe.config.ts covers the TESTS, but not global setup, which calls
 * `chromium.launch()` directly and so never sees the project config. Playwright
 * 1.57 honours no environment override for that call -- verified, not assumed.
 *
 * Defaulting the channel here rather than editing `global-setup-fullstack.ts`
 * keeps upstream's file pristine AND keeps the change opt-in: it applies only
 * to a run passing `--config=playwright.dfe.config.ts`, so upstream's default
 * path and CI, which do have a bundled Chromium, are untouched.
 *
 * A caller's explicit channel still wins.
 */
import { chromium } from '@playwright/test';

import baseGlobalSetup from './global-setup-fullstack';

const launch = chromium.launch.bind(chromium);
chromium.launch = options => launch({ channel: 'chrome', ...options });

export default baseGlobalSetup;
