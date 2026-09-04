/**
 * DFE: the frame-ancestors CSP, set per request.
 *
 * Next only finds the proxy (formerly middleware) file beside `pages/`, so this
 * one file cannot live under `src/dfe/` like the rest of the fork -- it stays a
 * delegate, and the policy is in `src/dfe/embedCsp.ts`.
 *
 * No `config.matcher`: the default scope is every request, matching the
 * `/(.*)?` source of the build-time header this replaces.
 */
import { NextResponse } from 'next/server';

import { EMBED_CSP_HEADER, embedFrameAncestors } from '@/dfe/embedCsp';

export default function proxy() {
  const response = NextResponse.next();
  response.headers.set(EMBED_CSP_HEADER, embedFrameAncestors());
  return response;
}
