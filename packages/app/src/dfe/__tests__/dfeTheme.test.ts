/**
 * Fork-local coverage for the DFE brand theme.
 *
 * The theme registry validates SHAPE at import; these tests pin the brand
 * IDENTITY - the values a well-meaning upstream refactor of the shared theme
 * scaffolding could quietly reset. The primary scale is anchored on the brand
 * tokens in `_tokens.scss`, so those two anchors are asserted against the
 * stylesheet rather than duplicated as loose constants.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { FONT_VAR_MAP, MANTINE_FONT_MAP } from '@/config/fonts';
import { dfeTheme } from '@/theme/themes/dfe';
import { makeTheme } from '@/theme/themes/dfe/mantineTheme';

const tokensScss = readFileSync(
  join(__dirname, '../../theme/themes/dfe/_tokens.scss'),
  'utf-8',
);

const cssToken = (name: string): string => {
  const match = tokensScss.match(
    new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`),
  );
  if (!match) {
    throw new Error(`token --${name} not found in _tokens.scss`);
  }
  return match[1].toLowerCase();
};

describe('dfeTheme registration', () => {
  it('registers under the dfe name with the DFE display name', () => {
    expect(dfeTheme.name).toBe('dfe');
    expect(dfeTheme.displayName).toBe('DFE');
  });

  it('scopes its CSS custom properties with the theme-dfe class', () => {
    // ThemeProvider swaps exactly one class on <html>, so the token blocks must
    // be scoped to the class this theme declares.
    expect(dfeTheme.cssClass).toBe('theme-dfe');
    expect(tokensScss).toContain(
      ".theme-dfe[data-mantine-color-scheme='dark']",
    );
    expect(tokensScss).toContain(
      ".theme-dfe[data-mantine-color-scheme='light']",
    );
  });

  it('does not scope its tokens onto another theme class', () => {
    // These blocks began life as a copy of the hyperdx theme. Left pointing at
    // `.theme-hyperdx` they emit AFTER hyperdx's own block (both are @used from
    // _base-tokens.scss, dfe second), so equal specificity hands the win to us
    // and the hyperdx theme silently renders DFE brand colours.
    expect(tokensScss).not.toContain('.theme-hyperdx[');
    expect(tokensScss).not.toContain('.theme-clickstack[');
  });

  it('ships its own favicon set rather than upstream hyperdx branding', () => {
    expect(dfeTheme.favicon.svg).toBe('/favicons/dfe/favicon.svg');
    expect(dfeTheme.favicon.png32).toBe('/favicons/dfe/favicon-32x32.png');
    expect(dfeTheme.favicon.png16).toBe('/favicons/dfe/favicon-16x16.png');
    expect(dfeTheme.favicon.appleTouchIcon).toBe(
      '/favicons/dfe/apple-touch-icon.png',
    );
  });

  it('supplies a Wordmark and a Logomark', () => {
    expect(dfeTheme.Wordmark).toBeDefined();
    expect(dfeTheme.Logomark).toBeDefined();
  });
});

describe('DFE mantine theme', () => {
  const theme = dfeTheme.mantineTheme;

  it('uses the brand blue as primary, not the inherited olive yellow', () => {
    expect(theme.primaryColor).toBe('brand');
    expect(theme.primaryShade).toBe(6);
  });

  it('anchors the brand scale on the brand tokens', () => {
    const brand = theme.colors?.brand ?? [];
    expect(brand).toHaveLength(10);
    // shade 5 = the light action blue, shade 7 = the dark brand blue.
    expect(brand[5]?.toLowerCase()).toBe(cssToken('color-brand-secondary'));
    expect(brand[7]?.toLowerCase()).toBe(cssToken('color-brand-primary'));
  });

  it('keeps a yellow scale so leftover references still resolve', () => {
    expect(theme.colors?.yellow).toHaveLength(10);
  });

  it('takes the font family from its caller for both body and headings', () => {
    const custom = makeTheme({ fontFamily: 'TestFace, sans-serif' });
    expect(custom.fontFamily).toBe('TestFace, sans-serif');
    expect(custom.headings?.fontFamily).toBe('TestFace, sans-serif');
  });
});

describe('DFE work-UI fonts', () => {
  // The DFE console is pinned to Inter (tabular numerals, legible in dense
  // tables) with IBM Plex Mono for code. Both must stay resolvable, because
  // _app.tsx maps the DFE theme onto them by NAME.
  it('resolves Inter', () => {
    expect(FONT_VAR_MAP['Inter']).toBe('var(--font-inter)');
    expect(MANTINE_FONT_MAP['Inter']).toBe('var(--font-inter), sans-serif');
  });

  it('resolves IBM Plex Mono', () => {
    expect(FONT_VAR_MAP['IBM Plex Mono']).toBe('var(--font-ibm-plex-mono)');
    expect(MANTINE_FONT_MAP['IBM Plex Mono']).toBe(
      'var(--font-ibm-plex-mono), monospace',
    );
  });
});
