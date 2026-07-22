/**
 * Guards for DFE deltas that live INSIDE upstream files.
 *
 * Most fork code sits under `dfe/` and is tested directly. A handful of deltas
 * cannot: they are single lines wired into upstream modules (`_app.tsx`,
 * `layout.tsx`, `AppNav.tsx`, `next.config.mjs`) that are far too heavy to
 * import here - `next.config.mjs` is ESM with build plugins, `_app.tsx` pulls
 * the whole telemetry SDK.
 *
 * Those are exactly the deltas `git rerere` can drop silently: it replays a
 * recorded resolution TEXTUALLY, so an upstream refactor of the surrounding
 * lines can take our wiring with it and still merge clean. So we assert on the
 * source text - a blunt instrument, but it fails loudly at the moment the
 * wiring disappears instead of months later in production.
 *
 * Each path here is catalogued in `.fork-surface` and described in FORK.md.
 * The live behaviour is separately asserted post-deploy by dfe-infra's
 * hyperdx-embed smoke check.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP_ROOT = join(__dirname, '../../..');
const read = (relative: string) =>
  readFileSync(join(APP_ROOT, relative), 'utf-8');

describe('next.config.mjs - embed framing policy', () => {
  const nextConfig = read('next.config.mjs');

  it('allows dfe-ui to frame the app via a CSP frame-ancestors allowlist', () => {
    expect(nextConfig).toContain("frame-ancestors 'self'");
    expect(nextConfig).toContain('Content-Security-Policy');
  });

  it('takes extra framing origins from DFE_EMBED_FRAME_ANCESTORS', () => {
    // Per-deployment config: an external org embeds from its own origin, so
    // this must never be hardcoded to a HyperI host.
    expect(nextConfig).toContain('DFE_EMBED_FRAME_ANCESTORS');
  });

  it('does NOT send X-Frame-Options, which would defeat the allowlist', () => {
    // X-Frame-Options: DENY is all-or-nothing and, where both are sent,
    // browsers that honour it block the embed regardless of the CSP. Match the
    // header KEY, not the word - the comment above the block explains why we
    // avoid it and must not trip this.
    expect(nextConfig).not.toMatch(/key:\s*['"]X-Frame-Options['"]/i);
  });

  it('applies the policy to every route, not just the embedded ones', () => {
    expect(nextConfig).toMatch(/source:\s*'\/\(\.\*\)\?'/);
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
