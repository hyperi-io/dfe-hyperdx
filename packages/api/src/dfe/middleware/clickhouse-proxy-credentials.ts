// DFE: the ClickHouse proxy authenticates as the connection, never the caller.
//
// Upstream's /clickhouse-proxy forwards every incoming header and sets the
// connection's X-ClickHouse-User and X-ClickHouse-Key itself. A caller's own
// Authorization beside those makes ClickHouse refuse the query (code 516), and
// the dfe_token cookie would hand the engine token to the datastore.
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
  'x-clickhouse-ssl-certificate-auth',
] as const;

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
  }
  next();
}
