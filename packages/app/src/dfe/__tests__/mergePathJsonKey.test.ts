/**
 * mergePath quotes a native JSON key as one identifier, whatever the key holds.
 * The fix is security/patches/0006-json-facet-key-escape.patch, and
 * common-utils' dfe/__tests__/facetKeyQuoting.int.test.ts runs the result
 * against ClickHouse.
 */
import { quoteJsonSegment } from '@hyperdx/common-utils/dist/dfe/jsonPath';

import { mergePath } from '@/utils';

describe('mergePath on a native JSON column', () => {
  it.each([
    [
      'a backtick',
      'a`), (SELECT 1) AS z, toString(`b',
      'j.`a``), (SELECT 1) AS z, toString(``b`',
    ],
    ['a trailing backslash', 'ends\\', 'j.`ends\\\\`'],
    ['backticks round it, read as quoted', '`x`y`', 'j.`x``y`'],
    ['a plain key', 'plain', 'j.`plain`'],
  ])('quotes a key with %s', (_name, key, expected) => {
    expect(mergePath(['j', key], ['j'])).toBe(expected);
  });

  it('quotes each dotted segment the way the fork does', () => {
    expect(mergePath(['j', 'a.b`c'], ['j'])).toBe(
      `j.${quoteJsonSegment('a')}.${quoteJsonSegment('b`c')}`,
    );
  });
});
