// DFE Engine JWT Verification Middleware
//
// The DFE engine is the single JWT issuer. Envoy verifies the engine's
// ES384 token at the edge and forwards it; hyperdx is a Policy Enforcement
// Point and MUST verify it too (defence in depth) rather than trust an
// unauthenticated header. We verify against the engine's JWKS.
//
// On a valid token we resolve the user + team the same way the header
// middleware does (findOrCreateTeamByName / findOrCreateUserFromOIDC) and
// call req.login() so Passport's isUserAuthenticated() passes through.
// On a missing/invalid token we fall through (no 401 here) - the
// route-level isUserAuthenticated guard rejects unauthenticated requests.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';

import logger from '@/utils/logger';

import * as dfeConfig from '../config';
import { findOrCreateTeamByName } from '../controllers/team-provisioning';
import { findOrCreateUserFromOIDC } from '../controllers/user-provisioning';
import { oidcIdentityMiddleware } from './oidc-identity';

// Lazily-built remote JWKS. createRemoteJWKSet returns a key-resolver that
// fetches + caches the engine JWKS (with its own coalescing + cooldown), so
// we build it once and reuse it across requests.
let jwks: JWTVerifyGetKey | undefined;

function getJwks(): JWTVerifyGetKey {
  if (!jwks) {
    if (!dfeConfig.DFE_ENGINE_JWKS_URL) {
      throw new Error('DFE_ENGINE_JWKS_URL is not set');
    }
    jwks = createRemoteJWKSet(new URL(dfeConfig.DFE_ENGINE_JWKS_URL));
  }
  return jwks;
}

// Token source: Authorization: Bearer header, else a dfe_token cookie.
// We parse the raw Cookie header ourselves to avoid pulling in cookie-parser.
function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      return token;
    }
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) {
        continue;
      }
      const name = part.slice(0, eq).trim();
      if (name === 'dfe_token') {
        const value = part.slice(eq + 1).trim();
        return value ? decodeURIComponent(value) : undefined;
      }
    }
  }

  return undefined;
}

// Groups may arrive as a JSON array or a comma-separated string claim.
function extractGroups(payload: JWTPayload): string[] {
  const raw = (payload as Record<string, unknown>).groups;
  if (Array.isArray(raw)) {
    return raw.map(g => String(g).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map(g => g.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Express middleware that verifies the engine's ES384 JWT and resolves the
 * user + team from its claims. Falls through on missing/invalid tokens.
 */
export async function engineJwtMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = extractToken(req);
  if (!token) {
    // No engine token - fall through to existing Passport auth.
    return next();
  }

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getJwks(), {
      issuer: dfeConfig.DFE_ENGINE_ISSUER,
      algorithms: ['ES384'],
    });
    payload = result.payload;
  } catch (err) {
    // Invalid / expired / untrusted token. Do NOT 401 here; fall through so
    // the route-level isUserAuthenticated guard rejects the request.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'DFE: engine JWT verification failed',
    );
    return next();
  }

  const email = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!email) {
    logger.warn('DFE: engine JWT missing sub (email) claim');
    return next();
  }

  try {
    const groups = extractGroups(payload);
    const teamName = groups[0] || dfeConfig.DFE_AUTH_DEFAULT_TEAM || 'default';

    const { team } = await findOrCreateTeamByName(teamName);
    const { user } = await findOrCreateUserFromOIDC(email, team._id);

    // req.login() populates req.user and makes req.isAuthenticated() true.
    req.login(user, { session: false }, err => {
      if (err) {
        logger.error({ err, email }, 'DFE: req.login failed');
        return next(err);
      }
      next();
    });
  } catch (err) {
    logger.error({ err, email }, 'DFE: engine JWT identity resolution failed');
    next(err);
  }
}

/**
 * DFE identity middleware entry point wired into api-app.ts.
 *
 * Default (DFE_AUTH_MODE=oidc-proxy): verify the engine's ES384 JWT.
 * Dev fallback (DFE_AUTH_MODE=header-dev): trust the identity headers
 * without verification, so local dev works without a running engine.
 */
export async function dfeIdentityMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (dfeConfig.DFE_AUTH_MODE === 'header-dev') {
    return oidcIdentityMiddleware(req, res, next);
  }
  return engineJwtMiddleware(req, res, next);
}
