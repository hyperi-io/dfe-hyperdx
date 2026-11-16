/**
 * Fork-local coverage for the DFE brand.
 *
 * Upstream ships one brand and one palette, and takes ours through three
 * swapped references. These tests pin the brand IDENTITY and that wiring. The
 * primary scale is anchored on the brand tokens in `_tokens.scss`, so those two
 * anchors are asserted against the stylesheet rather than duplicated as
 * constants.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { MANTINE_FONT_MAP } from '@/config/fonts';
import { makeTheme, theme } from '@/theme/themes/dfe/mantineTheme';

const APP_ROOT = join(__dirname, '../../..');
const read = (relative: string) =>
  readFileSync(join(APP_ROOT, relative), 'utf-8');

const tokensScss = read('src/theme/themes/dfe/_tokens.scss');

const cssToken = (name: string): string => {
  const match = tokensScss.match(
    new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`),
  );
  if (!match) {
    throw new Error(`token --${name} not found in _tokens.scss`);
  }
  return match[1].toLowerCase();
};

type Brand = typeof import('@/dfe/brand');

function loadBrand(upstream: boolean): Brand {
  const pinned = process.env.DFE_UPSTREAM_BRAND;
  if (upstream) {
    process.env.DFE_UPSTREAM_BRAND = 'true';
  } else {
    delete process.env.DFE_UPSTREAM_BRAND;
  }
  try {
    let brand: Brand | undefined;
    jest.isolateModules(() => {
      brand = jest.requireActual<Brand>('@/dfe/brand');
    });
    if (!brand) {
      throw new Error('@/dfe/brand did not load');
    }
    return brand;
  } finally {
    process.env.DFE_UPSTREAM_BRAND = pinned;
  }
}

// The DFE logomark's viewBox, which upstream's ClickStack mark does not share.
const DFE_LOGOMARK_VIEWBOX = '0 0 113.77 78.052';

describe('the DFE brand', () => {
  it('names the console DFE with the DFE marks and theme', () => {
    const brand = loadBrand(false);

    expect(brand.dfeBrandName('ClickStack')).toBe('DFE');
    expect(brand.theme.primaryColor).toBe(theme.primaryColor);
    expect(brand.Logomark({}).props.viewBox).toBe(DFE_LOGOMARK_VIEWBOX);
    expect(brand.Wordmark({ name: 'DFE' }).type).toBe('div');
  });

  it('gives upstream its own brand under the test pin', () => {
    const brand = loadBrand(true);

    expect(brand.dfeBrandName('ClickStack')).toBe('ClickStack');
    expect(brand.theme.primaryColor).not.toBe(theme.primaryColor);
    expect(brand.Logomark({}).props.viewBox).not.toBe(DFE_LOGOMARK_VIEWBOX);
    expect(brand.Wordmark({ name: 'ClickStack' }).type).not.toBe('div');
  });
});

describe('upstream files take the DFE brand', () => {
  it('reads the name and marks in brand/index.tsx', () => {
    const index = read('src/brand/index.tsx');
    expect(index).toContain(
      "import { dfeBrandName, Logomark, Wordmark } from '@/dfe/brand';",
    );
    expect(index).toMatch(/BRAND_DISPLAY_NAME = dfeBrandName\(/);
  });

  it('reads the Mantine theme in ThemeWrapper.tsx', () => {
    expect(read('src/ThemeWrapper.tsx')).toContain(
      "import { theme as baseTheme } from '@/dfe/brand';",
    );
  });

  it('reads the CSS tokens in theme/_base-tokens.scss', () => {
    const baseTokens = read('src/theme/_base-tokens.scss');
    expect(baseTokens).toContain("@use './themes/dfe/tokens';");
    expect(baseTokens).not.toContain("@use './tokens';");
  });

  it('emits its tokens for both colour schemes, unscoped', () => {
    // Nothing puts a theme class on <html> any more, so a scoped block would
    // never match.
    expect(tokensScss).toContain("\n[data-mantine-color-scheme='dark'] {");
    expect(tokensScss).toContain("\n[data-mantine-color-scheme='light'] {");
    expect(tokensScss).not.toMatch(/\.theme-[a-z]+\[/);
  });

  it('links the DFE favicon set in _document.tsx', () => {
    const document = read('pages/_document.tsx');
    expect(document).toContain('/favicons/dfe/favicon.svg');
    expect(document).not.toContain('/favicons/clickstack/');
  });
});

describe('DFE mantine theme', () => {
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

describe('DFE work-UI font', () => {
  // The console is pinned to Inter (tabular numerals, legible in dense tables),
  // and _app.tsx hands it to the theme wrapper by NAME.
  it('resolves Inter', () => {
    expect(MANTINE_FONT_MAP['Inter']).toBe('var(--font-inter), sans-serif');
  });
});
