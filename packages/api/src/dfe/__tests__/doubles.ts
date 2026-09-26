/**
 * Test doubles for the DFE suites.
 *
 * A partial Request, a partial Response, or a mongoose model with one method
 * swapped for a mock all assert a narrower type than the real thing, which is
 * what `no-unsafe-type-assertion` flags. The assertion is unavoidable for a
 * double, so it lives here once rather than once per test file.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion --
 * The assertion IS the helper - see the module note above.
 */
import type { Request, Response } from 'express';

/**
 * A Request carrying only the fields the middleware under test reads.
 *
 * The parameter is `object` rather than `Partial<Request>` because express's
 * own members are overloaded - a jest mock for `login` satisfies neither
 * overload, so a `Partial<Request>` parameter just pushes the assertion back
 * out to every caller.
 */
export function makeRequest(fields: object = {}): Request {
  return fields as Request;
}

/**
 * A Response whose `status`, `json` and `sendStatus` are chainable jest mocks.
 * Anything passed in wins, so a test can supply its own spy.
 */
export function makeResponse(fields: Partial<Response> = {}): Response {
  const r: Partial<Response> = { ...fields };
  r.status ??= jest.fn(() => r as Response);
  r.json ??= jest.fn(() => r as Response);
  r.sendStatus ??= jest.fn(() => r as Response);
  return r as Response;
}

/**
 * A plain fixture standing in for a controller's resolved mongoose document,
 * whose 50-plus Document methods no fixture can satisfy structurally.
 */
export function makeDocument<T>(fields: object): T {
  return fields as T;
}
