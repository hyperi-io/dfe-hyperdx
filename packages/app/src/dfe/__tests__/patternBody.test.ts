import { readFileSync } from 'fs';
import { join } from 'path';

import { dfePatternBody } from '@/dfe/patternBody';

describe('dfePatternBody', () => {
  it.each([
    ['a string body, unchanged', 'GET /index 200', 'GET /index 200'],
    ['an empty string', '', ''],
    ['null', null, ''],
    ['undefined', undefined, ''],
    ['a JSON object body', { a: 1, b: 'x' }, '{"a":1,"b":"x"}'],
    ['a nested JSON body', { a: { b: [1, 2] } }, '{"a":{"b":[1,2]}}'],
    ['an array', [1, 'x'], '[1,"x"]'],
    ['a number', 42, '42'],
    ['a boolean', false, 'false'],
  ])('%s', (_name, input, expected) => {
    expect(dfePatternBody(input)).toBe(expected);
  });

  it('always returns a string, so drain3 can call strip() on it', () => {
    expect(typeof dfePatternBody({ _json: { msg: 'x' } })).toBe('string');
  });
});

describe('hooks/usePatterns.tsx wiring', () => {
  // A merge can drop the call sites and still resolve clean.
  const source = readFileSync(
    join(__dirname, '../../hooks/usePatterns.tsx'),
    'utf-8',
  );

  it('reads both pattern bodies through dfePatternBody', () => {
    expect(
      source.match(/dfePatternBody\(\w+\[PATTERN_COLUMN_ALIAS\]\)/g),
    ).toHaveLength(2);
  });
});
