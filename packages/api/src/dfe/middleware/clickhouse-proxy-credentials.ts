// DFE: the ClickHouse proxy authenticates as the connection, never the caller.
//
// Upstream's /clickhouse-proxy forwards every incoming header and query param,
// and sets the connection's X-ClickHouse-User and X-ClickHouse-Key itself. A
// caller's own Authorization or ?user= beside those makes ClickHouse refuse the
// query (code 516), and the dfe_token cookie would hand the engine token to the
// datastore.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

import { isDfeEnabled } from '@/dfe/config';

// The caller's credentials to HyperDX, and every header ClickHouse reads as one.
const CLIENT_CREDENTIAL_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-clickhouse-user',
  'x-clickhouse-key',
  'x-clickhouse-quota',
  'x-clickhouse-ssl-certificate-auth',
] as const;

// The query params ClickHouse's HTTP interface authenticates with.
const CLIENT_CREDENTIAL_PARAMS = ['user', 'password', 'quota_key'] as const;

/** `url` without the credential params; byte-identical when it carries none. */
function withoutCredentialParams(url: string): string {
  const start = url.indexOf('?');
  if (start === -1) {
    return url;
  }
  const params = new URLSearchParams(url.slice(start + 1));
  if (!CLIENT_CREDENTIAL_PARAMS.some(name => params.has(name))) {
    return url;
  }
  for (const name of CLIENT_CREDENTIAL_PARAMS) {
    params.delete(name);
  }
  const query = params.toString();
  return query ? `${url.slice(0, start)}?${query}` : url.slice(0, start);
}

/** Remove the caller's credentials before the proxy copies them (DFE mode only). */
export function dropClientCredentials(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (isDfeEnabled) {
    for (const name of CLIENT_CREDENTIAL_HEADERS) {
      /* eslint-disable-next-line security/detect-object-injection --
       * every name is a constant from the list above */
      delete req.headers[name];
    }
    // The proxy rewrites and forwards req.url, the path below this mount.
    req.url = withoutCredentialParams(req.url);
  }
  next();
}
