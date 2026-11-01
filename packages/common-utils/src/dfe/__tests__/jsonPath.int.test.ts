/**
 * JSON path quoting against a real ClickHouse.
 *
 * A JSON key is telemetry, so whoever sends a log picks it. Each key here is
 * quoted the way search and the exported rules quote it, and the predicate must
 * still match only the row holding that key: a quoting ClickHouse reads
 * differently closes the identifier and the rest of the key becomes SQL.
 *
 * Upstream's copy of the quoting is fixed by
 * security/patches/0005-json-path-backslash-escape.patch.
 */
import { ClickHouseClient, createClient } from '@clickhouse/client';

import { quoteIdentifierIfNeeded } from '@/core/metadata';
import {
  coerceJsonPathsInSql,
  quoteJsonSegment,
  renderJsonStringExpression,
} from '@/dfe/jsonPath';

describe('JSON path quoting integration', () => {
  let client: ClickHouseClient;

  const TABLE = 'default.dfe_json_path_quoting_int_test';

  // One hostile key per row. Each predicate below asks for one of them.
  const KEYS = ["x\\`) = '' OR 1=1 --", 'ends\\', 'a\\\\`b', 'plain'];

  const idsWhere = async (predicate: string) => {
    const result = await client.query({
      query: `SELECT Id FROM ${TABLE} WHERE ${predicate} ORDER BY Id`,
      format: 'JSONEachRow',
    });
    return (await result.json<{ Id: number }>()).map(r => Number(r.Id));
  };

  beforeAll(async () => {
    client = createClient({
      url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || '',
    });
    await client.command({
      query: `CREATE OR REPLACE TABLE ${TABLE} (Id UInt32, j JSON)
        ENGINE = MergeTree ORDER BY Id`,
    });
    await client.insert({
      table: TABLE,
      values: KEYS.map((key, i) => ({ Id: i + 1, j: { [key]: 'v' } })),
      format: 'JSONEachRow',
    });
  });

  afterAll(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
    await client.close();
  });

  const quotings: [string, (key: string) => string][] = [
    ['quoteJsonSegment', key => renderJsonStringExpression('j', [key])],
    [
      "upstream's quoteJsonPathSegment",
      key => `toString(j.${quoteIdentifierIfNeeded(key)})`,
    ],
    [
      'the render-time coercion',
      key => coerceJsonPathsInSql(`j.${quoteJsonSegment(key)}`, ['j']),
    ],
  ];

  describe.each(quotings)('%s', (_, expression) => {
    it.each(KEYS.map((key, i) => [key, i + 1]))(
      'matches only the row holding %j',
      async (key, id) => {
        expect(await idsWhere(`${expression(key)} = 'v'`)).toEqual([id]);
      },
    );

    it.each(KEYS)('matches nothing for a value %j does not hold', async key => {
      expect(await idsWhere(`${expression(key)} = 'nomatch'`)).toEqual([]);
    });
  });

  it('both quotings agree on every key', () => {
    for (const key of KEYS.filter(k => k !== 'plain')) {
      expect(quoteIdentifierIfNeeded(key)).toBe(quoteJsonSegment(key));
    }
  });
});
