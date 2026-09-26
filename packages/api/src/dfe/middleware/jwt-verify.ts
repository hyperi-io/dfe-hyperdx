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
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import * as dfeConfig from '@/dfe/config';
import { ensureOrgConnection } from '@/dfe/controllers/org-connection';
import { findOrCreateTeamByName } from '@/dfe/controllers/team-provisioning';
import { findOrCreateUserFromOIDC } from '@/dfe/controllers/user-provisioning';
import logger from '@/utils/logger';

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
// Exported so DFE routers (e.g. create-rule) can forward the caller's engine
// token upstream without re-implementing the header/cookie extraction.
export function extractToken(req: Request): string | undefined {
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

// Engine machine identity (dfe-engine#149): the engine self-signs short-lived
// service JWTs over the same JWKS trust, so no stored inter-service credential.
const SERVICE_SUBJECT = 'svc:dfe-engine';
const SERVICE_AUDIENCE = 'dfe-hyperdx';
// Synthetic principal the service identity acts as; unique-email safe.
const SERVICE_PRINCIPAL_EMAIL = 'svc-dfe-engine@dfe.internal';
// The only surface a service token may touch: team/source/connection control,
// plus the cross-team source fan-out the engine drives.
const SERVICE_CONTROL_PREFIXES = [
  '/team',
  '/sources',
  '/connections',
  '/dfe/sources',
];

function hasServiceAudience(payload: JWTPayload): boolean {
  const aud = payload.aud;
  return Array.isArray(aud)
    ? aud.includes(SERVICE_AUDIENCE)
    : aud === SERVICE_AUDIENCE;
}

function isControlPath(path: string): boolean {
  return SERVICE_CONTROL_PREFIXES.some(
    prefix => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Resolve a verified service token to the internal admin principal on the
 * default team, JIT-creating that team so first-boot seeding works before any
 * human user exists. Non-control endpoints reject the service identity.
 */
async function handleServiceToken(
  req: Request,
  res: Response,
  next: NextFunction,
  payload: JWTPayload,
) {
  if (!hasServiceAudience(payload)) {
    // Wrong/missing audience is an invalid token: fall through like the rest.
    logger.warn(
      { aud: payload.aud },
      'DFE: service token missing dfe-hyperdx audience',
    );
    return next();
  }

  if (!isControlPath(req.path)) {
    logger.warn(
      { path: req.path },
      'DFE: service token rejected outside the control surface',
    );
    return res.sendStatus(403);
  }

  try {
    const teamName = dfeConfig.DFE_AUTH_DEFAULT_TEAM || 'default';
    const { team } = await findOrCreateTeamByName(teamName);
    const { user } = await findOrCreateUserFromOIDC(
      SERVICE_PRINCIPAL_EMAIL,
      team._id,
      'DFE Engine (service)',
    );
    // The one principal allowed on the admin surface (see dfe/middleware/admin-lockdown).
    req.dfeIsServicePrincipal = true;

    req.login(user, { session: false }, err => {
      if (err) {
        logger.error({ err }, 'DFE: service req.login failed');
        return next(err);
      }
      next();
    });
  } catch (err) {
    logger.error({ err }, 'DFE: service identity resolution failed');
    next(err);
  }
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

  if (payload.sub === SERVICE_SUBJECT) {
    return handleServiceToken(req, res, next, payload);
  }

  const email = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!email) {
    logger.warn('DFE: engine JWT missing sub (email) claim');
    return next();
  }

  // A session still on an issued password has no groups and would otherwise land in the default team.
  if (payload.password_change_required === true) {
    logger.warn({ email }, 'DFE: engine JWT is pending a password change');
    return next();
  }

  try {
    const groups = extractGroups(payload);
    const teamName = groups[0] || dfeConfig.DFE_AUTH_DEFAULT_TEAM || 'default';
    // Absent today; dfe/middleware/role-claim gates on the claim's presence.
    req.dfeRole = typeof payload.role === 'string' ? payload.role : undefined;

    const { team, created: teamCreated } =
      await findOrCreateTeamByName(teamName);
    const { user } = await findOrCreateUserFromOIDC(email, team._id);
    // Seed the caller's OWN org connection only on the request that created the
    // team. First login fires team + sources + connections at once, so gating on
    // the unique creator stops them racing duplicate connections onto one team.
    // Non-fatal - a HyperDX login never blocks on the engine.
    if (teamCreated) {
      await ensureOrgConnection(token, String(team._id));
    }

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
