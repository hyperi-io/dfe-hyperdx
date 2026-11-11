// Routes validated through zod-express-middleware get the PARSED request, with
// inherited-property keys stripped, so undeclared keys never reach a mongoose
// write (GHSA-8332). api-app.ts imports this first, before any router loads.

import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- an ES import binding cannot reassign the library's exports
const library = require('zod-express-middleware');

const INHERITED_KEYS = ['__proto__', 'constructor', 'prototype'];

/** Delete every own `__proto__`, `constructor` and `prototype` key, at any depth. */
export function stripInheritedKeys(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node !== 'object' || node === null) {
      continue;
    }
    for (const key of INHERITED_KEYS) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        Reflect.deleteProperty(node, key);
      }
    }
    for (const child of Object.values(node)) {
      if (typeof child === 'object' && child !== null) {
        pending.push(child);
      }
    }
  }
}

type Schemas = { params?: ZodSchema; query?: ZodSchema; body?: ZodSchema };

/** zod-express-middleware's validateRequest, handing on the parsed request. */
export function validateRequest(schemas: Schemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: { type: 'Params' | 'Query' | 'Body'; errors: unknown }[] = [];
    if (schemas.params) {
      const parsed = schemas.params.safeParse(req.params);
      if (parsed.success) {
        req.params = parsed.data;
      } else {
        errors.push({ type: 'Params', errors: parsed.error });
      }
    }
    if (schemas.query) {
      const parsed = schemas.query.safeParse(req.query);
      if (parsed.success) {
        req.query = parsed.data;
      } else {
        errors.push({ type: 'Query', errors: parsed.error });
      }
    }
    if (schemas.body) {
      const parsed = schemas.body.safeParse(req.body);
      if (parsed.success) {
        req.body = parsed.data;
      } else {
        errors.push({ type: 'Body', errors: parsed.error });
      }
    }
    if (errors.length > 0) {
      return library.sendErrors(errors, res);
    }
    stripInheritedKeys(req.params);
    stripInheritedKeys(req.query);
    stripInheritedKeys(req.body);
    return next();
  };
}

library.validateRequest = validateRequest;
library.processRequest = validateRequest;
