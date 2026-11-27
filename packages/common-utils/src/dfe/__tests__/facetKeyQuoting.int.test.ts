/**
 * A JSON facet key against a real ClickHouse.
 *
 * The filter panel asks `getKeyValues` for each key's values, with the key
 * quoted the way the app's `mergePath` quotes a native JSON path. A JSON key is
 * telemetry, so whoever sends a log picks it, and the facet query must read it
 * as one identifier: a quoting ClickHouse reads differently closes the
 * identifier and the rest of the key becomes SQL.
 *
 * Upstream's copy of the quoting is fixed by
 * security/patches/0006-json-facet-key-escape.patch.
 */
import { ClickHouseClient, createClient } from '@clickhouse/client';

import { ClickhouseClient as HdxClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';
import { quoteJsonSegment } from '@/dfe/jsonPath';
import { BuilderChartConfigWithDateRange, SourceKind, TSource } from '@/types';

describe('JSON facet key quoting integration', () => {
  let client: ClickHouseClient;
  let hdxClient: HdxClickhouseClient;

  const TABLE = 'dfe_facet_key_quoting_int_test';

  // One key per row. The first would add a column of its own to the facet
  // query if it closed the identifier, the next two are re-quoted by the facet
  // render, and the fourth is a key that reads like a type hint.
  const KEYS = [
    'a`), (SELECT count() FROM numbers(1)) AS z, toString(`b',
    'ends\\',
    'tick`ed',
    'n.:String',
    'plain',
  ];

  const source: TSource = {
    id: 'facet-source',
    name: 'Facets',
    kind: SourceKind.Log,
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: TABLE },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: '*',
  };

  const chartConfig: BuilderChartConfigWithDateRange = {
    connection: 'conn-1',
    from: { databaseName: 'default', tableName: TABLE },
    dateRange: [new Date('2026-01-01'), new Date('2027-01-01')],
    select: '',
    timestampValueExpression: 'Timestamp',
    where: '',
  };

  // The facet key mergePath(['j', key], ['j']) renders.
  const facetKey = (key: string) =>
    `j.${key.split('.').map(quoteJsonSegment).join('.')}`;

  beforeAll(async () => {
    const host = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
    const username = process.env.CLICKHOUSE_USER || 'default';
    const password = process.env.CLICKHOUSE_PASSWORD || '';
    client = createClient({ url: host, username, password });
    hdxClient = new HdxClickhouseClient({ host, username, password });
    await client.command({
      query: `CREATE OR REPLACE TABLE default.${TABLE}
        (Timestamp DateTime64(9), j JSON) ENGINE = MergeTree ORDER BY Timestamp`,
    });
    await client.insert({
      table: `default.${TABLE}`,
      values: KEYS.map((key, i) => ({
        Timestamp: '2026-06-01 12:00:00',
        j: { [key]: `v${i}` },
      })),
      format: 'JSONEachRow',
    });
  });

  afterAll(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS default.${TABLE}` });
    await hdxClient.close();
    await client.close();
  });

  describe.each([true, false])('with disableRowLimit=%s', disableRowLimit => {
    it.each(KEYS.map((key, i) => [key, `v${i}`]))(
      'returns only the value %j holds',
      async (key, value) => {
        const metadata = new Metadata(hdxClient, new MetadataCache());

        const result = await metadata.getKeyValues({
          chartConfig,
          keys: [facetKey(key)],
          disableRowLimit,
          source,
        });

        expect(result).toEqual([{ key: facetKey(key), value: [value] }]);
      },
    );
  });
});
