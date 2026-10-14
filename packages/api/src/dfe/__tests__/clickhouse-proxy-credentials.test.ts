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
  'x-clickhouse-quota': 'their-quota',
  'x-clickhouse-ssl-certificate-auth': 'on',
  'x-hyperdx-connection-id': '507f1f77bcf86cd799439011',
  'content-type': 'text/plain',
});

const callerUrl =
  '/?default_format=JSONCompact&user=x&password=y&quota_key=q&param_p0=a%2Bb';

beforeEach(() => {
  mockDfeEnabled = true;
});

describe('dropClientCredentials', () => {
  test('removes every caller credential and keeps the rest', () => {
    const req = makeRequest({ headers: callerHeaders(), url: callerUrl });
    const next = jest.fn();

    dropClientCredentials(req, makeResponse(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.headers).toEqual({
      'x-hyperdx-connection-id': '507f1f77bcf86cd799439011',
      'content-type': 'text/plain',
    });
    expect(req.url).toBe('/?default_format=JSONCompact&param_p0=a%2Bb');
  });

  test.each([
    ['/?default_format=JSONCompact', '/?default_format=JSONCompact'],
    ['/', '/'],
    ['/?user=x', '/'],
    ['/?%75ser=x&query_id=q1', '/?query_id=q1'],
  ])('rewrites %s to %s', (url, expected) => {
    const req = makeRequest({ headers: {}, url });

    dropClientCredentials(req, makeResponse(), jest.fn());

    expect(req.url).toBe(expected);
  });

  test('outside DFE mode the request is upstream behaviour, untouched', () => {
    mockDfeEnabled = false;
    const req = makeRequest({ headers: callerHeaders(), url: callerUrl });
    const next = jest.fn();

    dropClientCredentials(req, makeResponse(), next);

    expect(next).toHaveBeenCalledWith();
    expect(req.headers).toEqual(callerHeaders());
    expect(req.url).toBe(callerUrl);
  });
});
