/**
 * Fork-local coverage for native ClickHouse JSON path expressions.
 *
 * Two jobs here, and the second matters more than the first:
 *
 *  1. Assert OUR behaviour - a native JSON root gets coerced with toString()
 *     before the extract, because JSONExtract* rejects Dynamic (code 43) and
 *     col['k'] on a JSON column is arrayElement, which ClickHouse also rejects.
 *
 *  2. Assert we still AGREE WITH UPSTREAM everywhere else. dfeJsonExtractQuery
 *     duplicates upstream's base-column computation rather than delegating to
 *     it (delegating would mean an import cycle), and a silent divergence there
 *     is the one real risk in this design. So every non-native case is checked
 *     against the real buildJSONExtractQuery. If an upstream sync changes that
 *     function or mergePath under us, this fails in our own CI instead of
 *     shipping a broken WHERE clause.
 */
import { renderJsonStringExpression } from '@hyperdx/common-utils/dist/dfe/jsonPath';

import { buildJSONExtractQuery } from '@/components/DBRowJsonViewer';
import {
  dfeJsonColumnPath,
  dfeJsonExtractQuery,
  type JSONExtractFn,
} from '@/dfe/clickhouseJsonPath';

describe('dfeJsonColumnPath', () => {
  it('emits toString() for a bare native JSON column, exactly as upstream does', () => {
    expect(dfeJsonColumnPath(['_json'])).toBe('toString(_json)');
  });

  it('takes the sub-path instead of subscripting the JSON column', () => {
    // col['k'] on a JSON column is arrayElement -> "Illegal types of arguments".
    expect(dfeJsonColumnPath(['_json', '_source'])).toBe(
      'toString(_json.`_source`)',
    );
  });

  it('handles a deep path', () => {
    expect(dfeJsonColumnPath(['_json', 'a', 'b', 'c'])).toBe(
      'toString(_json.`a`.`b`.`c`)',
    );
  });

  it('quotes numeric-looking segments rather than emitting array indices', () => {
    expect(dfeJsonColumnPath(['_json', '0', 'id'])).toBe(
      'toString(_json.`0`.`id`)',
    );
  });

  // JSONExtractString returns '' for anything that is not a JSON string, so the
  // old shape matched zero rows on a number or a boolean. toString() of the
  // sub-path gives the same text the sidebar facet offers.
  it('renders the same expression whatever the value type', () => {
    expect(dfeJsonColumnPath(['_json', 'port'])).toBe('toString(_json.`port`)');
  });

  // The sidebar renders a facet through the query-render seam. If these two
  // disagree, a filter added from a row never merges with a ticked facet.
  it('agrees with the seam the filter sidebar renders through', () => {
    expect(dfeJsonColumnPath(['_json', 'user', 'name'])).toBe(
      renderJsonStringExpression('_json', ['user', 'name']),
    );
  });

  it('escapes a backtick in an ingest-controlled key', () => {
    expect(dfeJsonColumnPath(['_json', 'a`b'])).toBe('toString(_json.`a``b`)');
  });
});

describe('dfeJsonExtractQuery - native JSON root (our delta)', () => {
  it('coerces the base column before extracting', () => {
    expect(
      dfeJsonExtractQuery(
        ['LogAttributes', 'config', 'host'],
        ['LogAttributes', 'config'],
        ['LogAttributes'],
      ),
    ).toBe("JSONExtractString(toString(LogAttributes.`config`), 'host')");
  });

  it('applies to the typed extract functions too', () => {
    expect(
      dfeJsonExtractQuery(['j', 'count'], ['j'], ['j'], 'JSONExtractFloat'),
    ).toBe("JSONExtractFloat(toString(j), 'count')");
  });

  // Key names come from ingest, so an unescaped quote closes the literal and
  // the rest of the key lands in the WHERE clause as SQL.
  it('escapes a quote in a key rather than breaking out of the literal', () => {
    expect(dfeJsonExtractQuery(['j', "x') OR 1=1 --"], ['j'], ['j'])).toBe(
      "JSONExtractString(toString(j), 'x\\') OR 1=1 --')",
    );
  });
});

describe('dfeJsonExtractQuery agrees with upstream for everything else', () => {
  // Each case is [label, args]. `jsonColumns` never contains the root here -
  // those are upstream's cases and our output must be byte-identical.
  const cases: Array<[string, Parameters<typeof buildJSONExtractQuery>]> = [
    [
      'single-level String column',
      [['LogAttributes', 'field1'], ['LogAttributes']],
    ],
    ['nested path', [['LogAttributes', 'nested', 'field3'], ['LogAttributes']]],
    [
      'JSONExtractFloat',
      [['SpanAttributes', 'count'], ['SpanAttributes'], [], 'JSONExtractFloat'],
    ],
    [
      'JSONExtractBool',
      [['LogAttributes', 'enabled'], ['LogAttributes'], [], 'JSONExtractBool'],
    ],
    [
      'array-index-looking segments',
      [['LogAttributes', '0', 'id'], ['LogAttributes']],
    ],
    [
      'Map column with parsed JSON value',
      [
        ['LogAttributes', 'config', 'host'],
        ['LogAttributes', 'config'],
      ],
    ],
    [
      'deeply nested Map column',
      [
        ['LogAttributes', 'config', 'database', 'host'],
        ['LogAttributes', 'config'],
      ],
    ],
    [
      'Map column with numeric sub-key (HDX-4369)',
      [
        ['LogAttributes', '1', 'foo'],
        ['LogAttributes', '1'],
        [],
        'JSONExtractString',
        ['LogAttributes'],
      ],
    ],
    ['no nested path -> null', [['LogAttributes'], ['LogAttributes']]],
    ['keyPath shorter than root -> null', [[], ['LogAttributes']]],
  ];

  it.each(cases)('%s', (_label, args) => {
    expect(dfeJsonExtractQuery(...args)).toBe(buildJSONExtractQuery(...args));
  });

  it('covers every extract function the type allows', () => {
    const fns: JSONExtractFn[] = [
      'JSONExtractString',
      'JSONExtractFloat',
      'JSONExtractBool',
    ];
    for (const fn of fns) {
      expect(dfeJsonExtractQuery(['a', 'b'], ['a'], [], fn)).toBe(
        buildJSONExtractQuery(['a', 'b'], ['a'], [], fn),
      );
    }
  });
});
