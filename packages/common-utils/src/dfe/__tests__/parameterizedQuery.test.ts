/**
 * An exported search names its source's table. A table whose name is not a plain
 * identifier, such as an own-table source `ingest-edge`, must reach the engine
 * quoted: unquoted, ClickHouse reads `dfe.ingest-edge` as a subtraction.
 */
import { dfeParameterizedQueryToSql } from '@/dfe/parameterizedQuery';

const FROM =
  'SELECT _json FROM {db:Identifier}.{tbl:Identifier} WHERE {w:String}';

const render = (db: string, tbl: string) =>
  dfeParameterizedQueryToSql({
    sql: FROM,
    params: { db, tbl, w: 'level' },
  });

describe('dfeParameterizedQueryToSql', () => {
  it.each([
    ['plain names stay bare', 'dfe', 'main', 'dfe.main'],
    ['a hyphen is quoted', 'dfe', 'ingest-edge', 'dfe.`ingest-edge`'],
    ['a leading digit is quoted', 'dfe', '2fa_log', 'dfe.`2fa_log`'],
    ['a dot is quoted', 'dfe', 'a.b', 'dfe.`a.b`'],
    ['a database is quoted too', 'my-db', 'main', '`my-db`.main'],
    ['a name already quoted is not quoted twice', 'dfe', '`a-b`', 'dfe.`a-b`'],
  ])('%s', (_label, db, tbl, expected) => {
    expect(render(db, tbl)).toBe(`SELECT _json FROM ${expected} WHERE 'level'`);
  });

  it('leaves a non-identifier parameter as upstream renders it', () => {
    expect(
      dfeParameterizedQueryToSql({
        sql: 'SELECT {n:Int32}, {s:String}',
        params: { n: 7, s: 'x y' },
      }),
    ).toBe("SELECT 7, 'x y'");
  });

  it('leaves a placeholder with no parameter alone', () => {
    expect(
      dfeParameterizedQueryToSql({
        sql: 'SELECT * FROM {tbl:Identifier}',
        params: {},
      }),
    ).toBe('SELECT * FROM {tbl:Identifier}');
  });
});
