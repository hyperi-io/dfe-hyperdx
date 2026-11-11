import { VendoredCoverage, vendoredFont } from '@/dfe/vendoredFont';

const font = { variable: 'cls' };
const fixed: VendoredCoverage = {
  variable: '--font-x',
  weights: ['300', '400'],
};
const range: VendoredCoverage = {
  variable: '--font-x',
  weights: { min: 100, max: 700 },
};

describe('vendoredFont', () => {
  it.each([
    ['static weights all vendored', fixed, ['300', '400'], '--font-x'],
    ['one static weight', fixed, '400', '--font-x'],
    ['variable range ends', range, ['100', '700'], '--font-x'],
  ])('returns the font for %s', (_case, coverage, weight, variable) => {
    const load = vendoredFont(font, 'X', coverage);
    expect(load({ weight, variable, subsets: ['latin'] })).toBe(font);
  });

  it.each([
    ['a static weight we lack', fixed, ['400', '500'], '--font-x', '500'],
    ['a weight above the range', range, ['400', '800'], '--font-x', '800'],
    ['a weight below the range', range, '50', '--font-x', '50'],
    ['a different CSS variable', fixed, ['400'], '--font-y', '--font-y'],
  ])('fails the build on %s', (_case, coverage, weight, variable, named) => {
    const load = vendoredFont(font, 'X', coverage);
    expect(() => load({ weight, variable })).toThrow(named);
  });
});
