// A bound on how wide a JSON request body may be before any route validates it.
//
// zod 3 parses every array element and record key even after a `.max()` has
// failed, and keeps an issue for each, so one 2.9 MB POST /dashboards body
// exhausts the API's heap and takes every org with it. Counting the parsed body
// first bounds that work for every route. Mounted in api-app.ts by
// security/patches/0004-json-body-bound.patch. Measurements are in
// docs/fork/security-sync.md.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';

// Upstream's 500-tile cap needs 1,450 at the shipped dashboards' 2.9 a tile,
// and the worst body at 2,000 holds the event loop for 1.9 s.
export const MAX_JSON_ARRAY_ELEMENTS = 2_000;

// The same 500 tiles need 14,000 at the shipped 28 a tile, and 20,000 record
// keys validate in 0.1 s.
export const MAX_JSON_OBJECT_MEMBERS = 20_000;

/** The bound `body` crosses, or null. Stops at the first container over it. */
export function exceededJsonBound(body: unknown): string | null {
  let elements = 0;
  let members = 0;
  const pending: unknown[] = [body];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    let children: unknown[];
    if (Array.isArray(value)) {
      elements += value.length;
      if (elements > MAX_JSON_ARRAY_ELEMENTS) {
        return `more than ${MAX_JSON_ARRAY_ELEMENTS} array elements`;
      }
      children = value;
    } else {
      children = Object.values(value);
      members += children.length;
      if (members > MAX_JSON_OBJECT_MEMBERS) {
        return `more than ${MAX_JSON_OBJECT_MEMBERS} object members`;
      }
    }
    for (const child of children) {
      if (typeof child === 'object' && child !== null) {
        pending.push(child);
      }
    }
  }
  return null;
}

/** 413 a JSON body wider than the bound, before a route's schema walks it. */
export function boundJsonBody(req: Request, res: Response, next: NextFunction) {
  const exceeded = exceededJsonBound(req.body);
  if (exceeded) {
    return res.status(413).json({
      error: `The request body has ${exceeded}, the most this API validates.`,
    });
  }
  return next();
}
