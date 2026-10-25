/**
 * A DFE deployment resolves an unmatched brand to dfe.
 *
 * getTheme and the chart palette fall back to the configured DEFAULT_THEME. The
 * app suite runs under NEXT_PUBLIC_THEME=hyperdx (jest.dfe.setup.js), so each
 * case reloads the real modules under a brand a DFE deployment runs with.
 */

const DFE_SUCCESS = '#00c28a';

type Loaded = {
  theme: typeof import('@/theme');
  utils: typeof import('@/utils');
};

function loadWith(brand: string | undefined): Loaded {
  if (brand === undefined) {
    delete process.env.NEXT_PUBLIC_THEME;
  } else {
    process.env.NEXT_PUBLIC_THEME = brand;
  }
  jest.resetModules();
  return {
    theme: jest.requireActual<typeof import('@/theme')>('@/theme'),
    utils: jest.requireActual<typeof import('@/utils')>('@/utils'),
  };
}

describe('the brand an unmatched theme resolves to', () => {
  const pinned = process.env.NEXT_PUBLIC_THEME;

  afterEach(() => {
    process.env.NEXT_PUBLIC_THEME = pinned;
    jest.resetModules();
    document.documentElement.className = '';
  });

  it.each([
    ['unset', undefined],
    ['dfe', 'dfe'],
  ])('is dfe when NEXT_PUBLIC_THEME is %s', (_label, brand) => {
    const { theme } = loadWith(brand);

    expect(theme.DEFAULT_THEME).toBe('dfe');
    // @ts-expect-error an unknown name is the input under test
    expect(theme.getTheme('no-such-theme').name).toBe('dfe');
  });

  it('gives a document with no theme class the DFE chart palette', () => {
    const { utils } = loadWith(undefined);

    expect(utils.getColorFromCSSToken('chart-success')).toBe(DFE_SUCCESS);
  });

  it('follows the hyperdx class on a DFE deployment', () => {
    const { utils } = loadWith(undefined);
    document.documentElement.classList.add('theme-hyperdx');

    expect(utils.getColorFromCSSToken('chart-success')).not.toBe(DFE_SUCCESS);
  });

  it('follows the configured brand on a hyperdx deployment', () => {
    const { theme } = loadWith('hyperdx');

    // @ts-expect-error an unknown name is the input under test
    expect(theme.getTheme('no-such-theme').name).toBe('hyperdx');
  });
});
