/**
 * Lucene range and comparison filters on a native-JSON sub-path, rendered the
 * way search renders them: upstream's serializer, then our JSON-path seam.
 *
 * The expected shapes were run on ClickHouse 26.9 with Int64, Float64 and
 * String rows under one path. A `toString()` operand compares lexically, so
 * `> '100'` matched 50 and 99, and `toString(...) BETWEEN 100 AND 500` fails
 * with NO_COMMON_TYPE.
 */
import type { ColumnMeta } from '@/clickhouse';
import { ClickhouseClient } from '@/clickhouse/node';
import { getMetadata } from '@/core/metadata';
import { dfeCoerceJsonPaths, dfeRangeField } from '@/dfe/jsonPath';
import { CustomSchemaSQLSerializerV2, SearchQueryBuilder } from '@/queryParser';

const metadata = getMetadata(
  new ClickhouseClient({ host: 'http://localhost:8123' }),
);
const column = (name: string, type: string): ColumnMeta => ({
  name,
  type,
  codec_expression: '',
  comment: '',
  default_expression: '',
  default_type: '',
  ttl_expression: '',
});
const columns = [column('_json', 'JSON'), column('bytes', 'UInt64')];
jest
  .spyOn(metadata, 'getColumn')
  .mockImplementation(async ({ column }) =>
    columns.find(c => c.name === column),
  );
jest.spyOn(metadata, 'getColumns').mockResolvedValue(columns);
jest
  .spyOn(metadata, 'getMaterializedColumnsLookupTable')
  .mockResolvedValue(new Map());
jest.spyOn(metadata, 'getSkipIndices').mockResolvedValue([]);
jest.spyOn(metadata, 'getSetting').mockResolvedValue('0');
jest.spyOn(metadata, 'getServerVersion').mockResolvedValue([26, 3, 17, 56]);
jest.spyOn(metadata, 'isClickHouseCloud').mockResolvedValue(false);

const where = { databaseName: 'dfe', tableName: 'main', connectionId: 'c1' };

async function render(lucene: string): Promise<string> {
  const serializer = new CustomSchemaSQLSerializerV2({
    metadata,
    ...where,
    implicitColumnExpression: 'Body',
  });
  const sql = await new SearchQueryBuilder(lucene, serializer).build();
  return dfeCoerceJsonPaths(sql, { metadata, ...where });
}

const GUARD =
  "dynamicType(`_json`.`bytes`) in ('Int8', 'Int16', 'Int32', 'Int64', " +
  "'Int128', 'Int256', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', " +
  "'UInt256', 'Float32', 'Float64')";
const NUMBER = 'toFloat64OrNull(toString(_json.`bytes`))';

describe('Lucene range on a native-JSON path', () => {
  it('renders the path as the left-hand side', async () => {
    expect(await render('_json.bytes:[100 TO 500]')).toBe(
      `((${GUARD} and ${NUMBER} BETWEEN 100 AND 500))`,
    );
  });

  it('negates it', async () => {
    expect(await render('-_json.bytes:[100 TO 500]')).toBe(
      `((${GUARD} and ${NUMBER} NOT BETWEEN 100 AND 500))`,
    );
  });

  it('renders an exclusive range as two bounds', async () => {
    expect(await render('_json.bytes:{100 TO 500}')).toBe(
      `((${GUARD} and ${NUMBER} > 100 AND ${GUARD} and ${NUMBER} < 500))`,
    );
  });

  it('renders a half-open range', async () => {
    expect(await render('_json.bytes:[100 TO *]')).toBe(
      `((${GUARD} and ${NUMBER} >= 100))`,
    );
  });

  it('leaves a range on a plain column as upstream renders it', async () => {
    expect(await render('bytes:[100 TO 500]')).toBe(
      '((bytes BETWEEN 100 AND 500))',
    );
  });
});

describe('Lucene comparison on a native-JSON path', () => {
  it('compares numerically, not as text', async () => {
    expect(await render('_json.bytes:>100')).toBe(
      `((${GUARD} and ${NUMBER} > '100'))`,
    );
  });

  it('still compares a text value as text', async () => {
    expect(await render('_json.name:"alice"')).toBe(
      "((toString(`_json`.`name`) = 'alice'))",
    );
  });
});

describe('dfeRangeField', () => {
  it('takes the numeric operand for a native-JSON path', () => {
    const field = { column: '', columnJSON: { string: 's', number: 'n' } };
    expect(dfeRangeField(field).column).toBe('n');
  });

  it('leaves any other field as it was', () => {
    const field = { column: 'bytes', columnJSON: undefined };
    expect(dfeRangeField(field)).toBe(field);
  });
});
