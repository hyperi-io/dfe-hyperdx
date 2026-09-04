/**
 * DFE legacy-auth lockdown: HyperDX's own password login, registration and
 * invite routes are refused in OIDC mode.
 *
 * Both halves are asserted here - the refusal with DFE mode on, and untouched
 * upstream behaviour with it off - because the rest of the suite runs with DFE
 * auth unset and never reaches the enforcing branch.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { makeRequest, makeResponse as res } from '@/dfe/__tests__/doubles';
import * as dfeConfig from '@/dfe/config';
import { blockLegacyAuthRoutes } from '@/dfe/middleware/legacy-auth-lockdown';

// The config module exports consts, so a test that varies them writes through
// a mutable view.
const config = dfeConfig as Record<string, unknown>;

const REFUSED = [
  '/login/password',
  '/register/password',
  '/team/setup/an-invite-token',
];

const ALLOWED = ['/health', '/installation', '/logout', '/search', '/sources'];

describe('blockLegacyAuthRoutes (DFE mode on)', () => {
  beforeEach(() => {
    config.isDfeEnabled = true;
  });

  test.each(REFUSED)('404s %s', path => {
    const r = res();
    const next = jest.fn();

    blockLegacyAuthRoutes(makeRequest({ path }), r, next);

    expect(r.sendStatus).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test.each(REFUSED)('404s %s with a trailing slash', path => {
    const r = res();
    const next = jest.fn();

    blockLegacyAuthRoutes(makeRequest({ path: `${path}/` }), r, next);

    expect(r.sendStatus).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('404s a mixed-case path', () => {
    // Express routing is case-insensitive by default, so /Login/Password
    // reaches the same handler and a case-sensitive gate is a bypass.
    const r = res();
    const next = jest.fn();

    blockLegacyAuthRoutes(makeRequest({ path: '/Login/Password' }), r, next);

    expect(r.sendStatus).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test.each(ALLOWED)('lets %s through', path => {
    const r = res();
    const next = jest.fn();

    blockLegacyAuthRoutes(makeRequest({ path }), r, next);

    expect(next).toHaveBeenCalled();
    expect(r.sendStatus).not.toHaveBeenCalled();
  });

  test('does not refuse a prefix collision', () => {
    // '/team/setup' is the invite route; '/team/setupless' is not, and the
    // /team router owns its own engine-only gate.
    const r = res();
    const next = jest.fn();

    blockLegacyAuthRoutes(makeRequest({ path: '/team/setupless' }), r, next);

    expect(next).toHaveBeenCalled();
    expect(r.sendStatus).not.toHaveBeenCalled();
  });
});

describe('blockLegacyAuthRoutes (DFE mode off)', () => {
  beforeEach(() => {
    config.isDfeEnabled = false;
  });

  test.each(REFUSED)('leaves upstream %s alone', path => {
    const r = res();
    const next = jest.fn();

    blockLegacyAuthRoutes(makeRequest({ path }), r, next);

    expect(next).toHaveBeenCalled();
    expect(r.sendStatus).not.toHaveBeenCalled();
  });
});

describe('api-app.ts wiring', () => {
  // The gate holds only while it is mounted, and nothing else here notices if
  // an upstream sync drops the line.
  const apiApp = readFileSync(join(__dirname, '../../api-app.ts'), 'utf-8');

  test('mounts the lockdown inside the DFE block', () => {
    expect(apiApp).toContain(
      "require('./dfe/middleware/legacy-auth-lockdown')",
    );
    expect(apiApp).toContain('app.use(blockLegacyAuthRoutes)');
  });

  test('mounts it ahead of the root router, which owns the routes', () => {
    expect(apiApp.indexOf('app.use(blockLegacyAuthRoutes)')).toBeLessThan(
      apiApp.indexOf('routers.rootRouter'),
    );
  });
});
