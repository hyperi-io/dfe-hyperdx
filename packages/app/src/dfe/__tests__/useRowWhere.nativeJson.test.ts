/**
 * A JSON column that ClickHouse returns already parsed must still hash.
 *
 * With a native JSON column the driver hands back an object, not the JSON text
 * upstream's row-identity path assumed. Passing the object straight to MD5
 * hashes "[object Object]", so every row in the table shares one identity and
 * the row side panel opens the wrong row. `useRowWhere.tsx` stringifies first -
 * this pins that.
 *
 * Migrated out of `src/hooks/__tests__/useRowWhere.test.tsx`, which is
 * upstream's.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * The MD5 double returns only the `toString` the code under test calls, which
 * is narrower than WordArray. The assertion IS the double.
 */
import MD5 from 'crypto-js/md5';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';

import { processRowToWhereClause } from '@/hooks/useRowWhere';

jest.mock('crypto-js/md5');

beforeEach(() => {
  jest.clearAllMocks();
  (MD5 as jest.Mock).mockImplementation((value: string) => ({
    toString: () => `md5_${value}`,
  }));
});

describe('processRowToWhereClause', () => {
  it('hashes the serialised object, not [object Object]', () => {
    const columnMap = new Map([
      [
        'data',
        {
          name: 'data',
          type: 'JSON',
          valueExpr: 'data',
          jsType: JSDataType.JSON,
        },
      ],
    ]);

    processRowToWhereClause({ data: { key: 'value' } }, columnMap);

    expect(MD5).toHaveBeenCalledWith('{"key":"value"}');
  });
});
