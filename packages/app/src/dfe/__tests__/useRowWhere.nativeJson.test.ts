/**
 * A JSON column that ClickHouse returns already parsed must still hash.
 *
 * With a native JSON column the driver hands back an object, not the JSON text
 * upstream's row-identity path assumed. Passing the object straight to SHA256
 * hashes "[object Object]", so every row in the table shares one identity and
 * the row side panel opens the wrong row. `useRowWhere.tsx` stringifies first -
 * this pins that.
 *
 * Migrated out of `src/hooks/__tests__/useRowWhere.test.tsx`, which is
 * upstream's.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * The SHA256 double returns only the `toString` the code under test calls,
 * which is narrower than WordArray. The assertion IS the double.
 */
import SHA256 from 'crypto-js/sha256';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';

import { processRowToWhereClause } from '@/hooks/useRowWhere';

jest.mock('crypto-js/sha256');

beforeEach(() => {
  jest.clearAllMocks();
  (SHA256 as jest.Mock).mockImplementation((value: string) => ({
    toString: () => `sha256_${value}`,
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

    expect(SHA256).toHaveBeenCalledWith('{"key":"value"}');
  });
});
