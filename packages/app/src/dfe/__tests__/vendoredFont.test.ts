import { VendoredCoverage, vendoredFont } from '@/dfe/vendoredFont';

const font = { variable: 'cls' };
const subsets = { latin: font, 'latin-ext': {}, cyrillic: {} };
const fixed: VendoredCoverage = {
  variable: '--font-x',
  weights: ['300', '400'],
  subsets,
};
const range: VendoredCoverage = {
  variable: '--font-x',
  weights: { min: 100, max: 700 },
  subsets,
};

describe('vendoredFont', () => {
  it.each([
    [
      'static weights all vendored',
      fixed,
      ['300', '400'],
      '--font-x',
      ['latin'],
    ],
    ['one static weight', fixed, '400', '--font-x', ['latin']],
    ['variable range ends', range, ['100', '700'], '--font-x', ['latin']],
    [
      'several vendored subsets',
      range,
      '400',
      '--font-x',
      ['latin', 'cyrillic'],
    ],
    ['no subsets named', range, '400', '--font-x', undefined],
  ])('returns the font for %s', (_case, coverage, weight, variable, wanted) => {
    const load = vendoredFont(font, 'X', coverage);
    expect(load({ weight, variable, subsets: wanted })).toBe(font);
  });

  it.each([
    ['a static weight we lack', fixed, ['400', '500'], '--font-x', [], '500'],
    ['a weight above the range', range, ['400', '800'], '--font-x', [], '800'],
    ['a weight below the range', range, '50', '--font-x', [], '50'],
    ['a different CSS variable', fixed, ['400'], '--font-y', [], '--font-y'],
    ['a subset we lack', range, '400', '--font-x', ['latin', 'greek'], 'greek'],
    [
      'a prototype key as subset',
      range,
      '400',
      '--font-x',
      ['toString'],
      'toString',
    ],
  ])(
    'fails the build on %s',
    (_case, coverage, weight, variable, wanted, named) => {
      const load = vendoredFont(font, 'X', coverage);
      expect(() => load({ weight, variable, subsets: wanted })).toThrow(named);
    },
  );
});
