/**
 * Guards for DFE deltas that jest cannot reach any other way.
 *
 * Most fork code sits under `dfe/` and is tested directly. A handful of deltas
 * cannot: they are single lines wired into upstream modules (`_app.tsx`,
 * `layout.tsx`, `AppNav.tsx`, `next.config.mjs`) that are far too heavy to
 * import here - `next.config.mjs` is ESM with build plugins, `_app.tsx` pulls
 * the whole telemetry SDK. `proxy.ts` sits outside `roots: ['<rootDir>/src']`,
 * so jest cannot import it either; the logic it delegates to is a `dfe/` module
 * with its own tests.
 *
 * Those are exactly the deltas `git rerere` can drop silently: it replays a
 * recorded resolution TEXTUALLY, so an upstream refactor of the surrounding
 * lines can take our wiring with it and still merge clean. So we assert on the
 * source text - a blunt instrument, but it fails loudly at the moment the
 * wiring disappears instead of months later in production.
 *
 * Every upstream path here is catalogued in `.fork-surface`, and all of them are
 * described in docs/fork/what-we-changed.md. The live behaviour is separately
 * asserted post-deploy by dfe-infra's hyperdx-embed smoke check.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_ROOT = join(__dirname, '../../..');
const read = (relative: string) =>
  readFileSync(join(APP_ROOT, relative), 'utf-8');

describe('next.config.mjs - embed framing policy', () => {
  const nextConfig = read('next.config.mjs');

  it('does NOT send X-Frame-Options, which would defeat the allowlist', () => {
    // X-Frame-Options: DENY is all-or-nothing and, where both are sent,
    // browsers that honour it block the embed regardless of the CSP. Match the
    // header KEY, not the word - the comment above the block explains why we
    // avoid it and must not trip this.
    expect(nextConfig).not.toMatch(/key:\s*['"]X-Frame-Options['"]/i);
  });

  it('sets no build-time CSP, which would intersect with the proxy one', () => {
    // A browser given two CSP headers enforces the intersection, so a
    // frame-ancestors fixed at build time narrows what proxy.ts sends.
    expect(nextConfig).not.toMatch(/key:\s*['"]Content-Security-Policy['"]/i);
    // And the allowlist is not read here at all: this file runs under `next
    // build`, where a deployment's value does not exist yet.
    expect(nextConfig).not.toContain('DFE_EMBED_FRAME_ANCESTORS');
  });
});

describe('proxy.ts - the request-time framing policy', () => {
  const proxy = read('proxy.ts');

  it('is wired to the fork allowlist rather than a literal origin', () => {
    // An external org embeds from its own origin, so no host is hardcoded.
    expect(proxy).toContain("from '@/dfe/embedCsp'");
    expect(proxy).toContain('response.headers.set(');
  });

  it('scopes to every request, not just the embedded routes', () => {
    // Next defaults to /:path*, the scope the build-time header's `/(.*)?`
    // source had; declaring a matcher would narrow it.
    expect(proxy).not.toMatch(/matcher\s*:/);
  });
});

describe('_app.tsx - route guard and font pin', () => {
  const app = read('pages/_app.tsx');

  it('route-blocks disabled features at the top level', () => {
    expect(app).toContain('isBlockedRoute');
    expect(app).toContain("router.replace('/search')");
  });

  it('guards on asPath, not pathname', () => {
    // A disabled feature has no page in the OSS build, so `pathname` is already
    // '/404' by the time we look - only `asPath` still carries e.g. '/alerts'.
    expect(app).toMatch(/router\.asPath\.split/);
  });

  it('feeds the embed colour scheme into the theme wrapper', () => {
    expect(app).toContain('useEmbedColorScheme');
    expect(app).toMatch(/colorScheme=\{colorScheme\}/);
  });

  it('pins the DFE console font to Inter regardless of user preference', () => {
    expect(app).toMatch(/isDFETheme\s*\|\|\s*isClickStackTheme\s*\?\s*'Inter'/);
  });
});

describe('DBDashboardPage.tsx - shipped dashboards are read-only', () => {
  const page = read('src/DBDashboardPage.tsx');

  it('reads the dashboard through the fork hook, not upstream useDashboard', () => {
    // The hook is the ONE place the save is dropped. Lose this swap and every
    // interaction on a shipped dashboard PATCHes again and 403s in the user's face.
    expect(page).toContain('useDfeDashboard({');
    expect(page).not.toMatch(/=\s*useDashboard\(\{/);
  });

  it('gates the grid and the tile toolbar on the managed flag', () => {
    expect(page).toContain('readOnly={isKioskMode || isDfeManaged}');
    expect(page).toContain('isDraggable={!isKioskMode && !isDfeManaged}');
    expect(page).toContain('isResizable={!isKioskMode && !isDfeManaged}');
  });

  it('offers Duplicate as the way to get an editable copy', () => {
    expect(page).toContain('duplicate-dashboard-menu-item');
    expect(page).toContain('duplicateDashboard(dashboard)');
  });
});

describe('DashboardsListPage.tsx - restoring the shipped set', () => {
  it('mounts the restore control', () => {
    expect(read('src/components/Dashboards/DashboardsListPage.tsx')).toContain(
      '<RestoreShippedDashboards />',
    );
  });
});

describe('layout.tsx and AppNav.tsx - chromeless embed', () => {
  it('renders no hyperdx nav when embedded, so dfe-ui owns the only nav', () => {
    expect(read('src/layout.tsx')).toContain('isEmbedChrome');
  });

  it('gates every nav link through the embed feature allowlist', () => {
    expect(read('src/components/AppNav/AppNav.tsx')).toContain(
      'isEmbedFeatureEnabled(link.id)',
    );
  });
});
