/**
 * DFE e2e global setup: upstream's, plus the two things a DFE host needs.
 *
 * 1. Browser launches go to the system Chrome. Playwright 1.57.0 ships no
 *    bundled Chromium for Ubuntu 26.04, so the pinned revision can never be
 *    fetched here. `channel: 'chrome'` in playwright.dfe.config.ts covers the
 *    TESTS, but not this setup, which calls `chromium.launch()` directly and so
 *    never sees the project config -- and Playwright 1.57 honours no
 *    environment override for that call.
 *
 * 2. The stored WHERE language is seeded to Lucene. The fork defaults it to SQL
 *    (see SearchWhereInput and commit 6cf72984), and upstream's `search-input`
 *    test id is rendered ONLY on the Lucene input, so on a fresh profile every
 *    upstream spec calling `performSearch` waits for an element that does not
 *    exist. Seeding the preference restores upstream's assumption for their
 *    specs without changing what a real DFE user gets.
 *
 * Both apply only to a run passing `--config=playwright.dfe.config.ts`, so
 * upstream's default path and CI are untouched.
 */
import fs from 'fs';
import path from 'path';
import { chromium, type FullConfig, request } from '@playwright/test';

import { dfeJsonSourceBody, seedDfeJson } from './dfe-json-seed';
import baseGlobalSetup from './global-setup-fullstack';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');
const APP_ORIGIN = `http://localhost:${process.env.HDX_E2E_APP_PORT || '21300'}`;
const API_URL = `http://localhost:${process.env.HDX_E2E_API_PORT || '21000'}`;
const LANGUAGE_KEY = 'hdx-search-where-language';

const launch = chromium.launch.bind(chromium);
chromium.launch = options => launch({ channel: 'chrome', ...options });

/** Add the Lucene preference to the storage state upstream's setup just saved. */
function seedLucenePreference(): void {
  if (!fs.existsSync(AUTH_FILE)) return;

  const state = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  state.origins ??= [];

  let origin = state.origins.find(
    (o: { origin: string }) => o.origin === APP_ORIGIN,
  );
  if (!origin) {
    origin = { origin: APP_ORIGIN, localStorage: [] };
    state.origins.push(origin);
  }
  origin.localStorage ??= [];

  const existing = origin.localStorage.find(
    (entry: { name: string }) => entry.name === LANGUAGE_KEY,
  );
  if (existing) {
    existing.value = 'lucene';
  } else {
    origin.localStorage.push({ name: LANGUAGE_KEY, value: 'lucene' });
  }

  fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
}

/** Register the native-JSON source against the team upstream's setup just created. */
async function createDfeJsonSource(): Promise<void> {
  const api = await request.newContext({
    baseURL: API_URL,
    storageState: AUTH_FILE,
  });
  try {
    const connections = await (await api.get('/connections')).json();
    const connectionId = connections?.[0]?.id ?? connections?.[0]?._id;
    if (!connectionId) {
      throw new Error('DFE JSON setup: no ClickHouse connection on the team');
    }

    const created = await api.post('/sources', {
      data: dfeJsonSourceBody(String(connectionId)),
    });
    if (!created.ok()) {
      throw new Error(
        `DFE JSON setup: source creation failed (${created.status()}): ${await created.text()}`,
      );
    }
  } finally {
    await api.dispose();
  }
}

export default async function dfeGlobalSetup(config: FullConfig) {
  const result = await baseGlobalSetup(config);
  seedLucenePreference();
  await seedDfeJson();
  await createDfeJsonSource();
  return result;
}
