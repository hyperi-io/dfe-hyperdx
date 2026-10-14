/**
 * The ClickHouse proxy drops the caller's credentials in DFE mode, so ClickHouse
 * sees only the connection's own X-ClickHouse-User and X-ClickHouse-Key.
 * `clickhouse-proxy-credentials.int.test.ts` runs the same through the real proxy.
 */
jest.mock('@/dfe/config', () => ({
  __esModule: true,
  get isDfeEnabled() {
    return mockDfeEnabled;
  },
}));

let mockDfeEnabled = true;

import { makeRequest, makeResponse } from '@/dfe/__tests__/doubles';
import { dropClientCredentials } from '@/dfe/middleware/clickhouse-proxy-credentials';

const callerHeaders = () => ({
  authorization: 'Bearer engine-token',
  'proxy-authorization': 'Basic cHJveHk6cHc=',
  cookie: 'dfe_token=engine-token; connect.sid=s%3Asession',
  'x-clickhouse-user': 'someone-else',
  'x-clickhouse-key': 'their-password',
  'x-clickhouse-ssl-certificate-auth': 'on',
  'x-hyperdx-connection-id': '507f1f77bcf86cd799439011',
  'content-type': 'text/plain',
});

beforeEach(() => {
  mockDfeEnabled = true;
});

describe('dropClientCredentials', () => {
  test('removes every caller credential and keeps the rest', () => {
    const req = makeRequest({ headers: callerHeaders() });
    const next = jest.fn();

    dropClientCredentials(req, makeResponse(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.headers).toEqual({
      'x-hyperdx-connection-id': '507f1f77bcf86cd799439011',
      'content-type': 'text/plain',
    });
  });

  test('outside DFE mode the request is upstream behaviour, untouched', () => {
    mockDfeEnabled = false;
    const req = makeRequest({ headers: callerHeaders() });
    const next = jest.fn();

    dropClientCredentials(req, makeResponse(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.headers).toEqual(callerHeaders());
  });
});
