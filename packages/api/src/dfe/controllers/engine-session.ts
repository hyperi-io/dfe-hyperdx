// The engine's decision on a session, which is where a user's HyperDX team
// comes from.
//
// An engine token's own `groups` claim grants nothing (dfe-engine#591): the
// engine resolves a session's groups from the account the token binds, on every
// request. A HyperDX team's connection is a ClickHouse user, so the team IS that
// user: its name is the username the engine hands this caller, one team per org
// plus one platform team. Two callers share a team only when the engine gives
// them the same ClickHouse identity. Anything short of a readable engine answer
// is a refusal.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { engineOrigin } from '@/dfe/controllers/org-connection';
import logger from '@/utils/logger';

const ENGINE_TIMEOUT_MS = 5000;

// A revoked group, a changed role or a deleted account reaches HyperDX within this window.
const CACHE_TTL_MS = 30_000;

const CACHE_MAX_ENTRIES = 1000;

/**
 * GET /api/v1/auth/me, read for the fields the decision needs. `groups` is what
 * the bound account holds, and is empty when the token binds no account.
 * `hyperdx_identity` is the ClickHouse username the engine hands this session,
 * empty when it hands none; `hyperdx_role` is the session's dashboard role. An
 * engine that predates either sends neither.
 */
const EngineSessionSchema = z.object({
  groups: z.array(z.string()),
  password_change_required: z.boolean().optional(),
  hyperdx_identity: z.string().optional(),
  hyperdx_role: z.string().optional(),
});

/**
 * GET /api/v1/hyperdx/connection, read for the username alone. The password in
 * the same body is stripped by the parse and never leaves this function.
 */
const ConnectionIdentitySchema = z.object({ username: z.string().min(1) });

type RefusalReason =
  | 'engine_refused'
  | 'no_group'
  | 'no_identity'
  | 'password_change'
  | 'engine_unavailable';

type Refusal = { granted: false; status: 401 | 403; reason: RefusalReason };

type EngineSession = { granted: true; team: string; role?: string } | Refusal;

interface EngineAnswer {
  session: EngineSession;
  // An answer the engine gave, as opposed to one it could not give.
  definitive: boolean;
}

const UNAVAILABLE: EngineAnswer = {
  session: { granted: false, status: 401, reason: 'engine_unavailable' },
  definitive: false,
};

interface CacheEntry {
  session: EngineSession;
  expiresAt: number;
}

// Keyed by a digest of the token so no bearer token sits in a long-lived map.
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<EngineSession>>();

function refused(status: 401 | 403, reason: RefusalReason): EngineAnswer {
  return { session: { granted: false, status, reason }, definitive: true };
}

/**
 * The ClickHouse username an engine that predates `hyperdx_identity` hands this
 * caller, asked of the connection read itself. Its refusal is the session's.
 */
async function identityFromConnection(
  origin: string,
  token: string,
): Promise<string | EngineAnswer> {
  const resp = await fetch(`${origin}/api/v1/hyperdx/connection`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
  });
  if (resp.status === 401) {
    return refused(401, 'engine_refused');
  }
  if (resp.status === 403) {
    return refused(403, 'no_identity');
  }
  if (!resp.ok) {
    logger.warn(
      { status: resp.status },
      'DFE: engine connection identity answered with an error',
    );
    return UNAVAILABLE;
  }
  const parsed = ConnectionIdentitySchema.safeParse(await resp.json());
  if (!parsed.success) {
    logger.warn('DFE: engine connection identity failed validation');
    return UNAVAILABLE;
  }
  return parsed.data.username.trim();
}

async function askEngine(token: string): Promise<EngineAnswer> {
  const origin = engineOrigin();
  if (!origin) {
    logger.warn('DFE: no engine origin to ask about the session');
    return UNAVAILABLE;
  }
  try {
    const resp = await fetch(`${origin}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    if (resp.status === 401 || resp.status === 403) {
      return refused(resp.status === 401 ? 401 : 403, 'engine_refused');
    }
    if (!resp.ok) {
      logger.warn(
        { status: resp.status },
        'DFE: engine session lookup answered with an error',
      );
      return UNAVAILABLE;
    }
    const parsed = EngineSessionSchema.safeParse(await resp.json());
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues },
        'DFE: engine session answer failed validation',
      );
      return UNAVAILABLE;
    }
    const me = parsed.data;
    if (me.password_change_required) {
      return refused(403, 'password_change');
    }
    if (!me.groups.some(group => group.trim())) {
      return refused(403, 'no_group');
    }

    const identity =
      me.hyperdx_identity === undefined
        ? await identityFromConnection(origin, token)
        : me.hyperdx_identity.trim();
    if (typeof identity !== 'string') {
      return identity;
    }
    if (!identity) {
      return refused(403, 'no_identity');
    }
    return {
      session: {
        granted: true,
        team: identity,
        role: me.hyperdx_role || undefined,
      },
      definitive: true,
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'DFE: engine session lookup failed',
    );
    return UNAVAILABLE;
  }
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function remember(
  key: string,
  session: EngineSession,
  tokenExpiresAt: number | undefined,
): void {
  const now = Date.now();
  const expiresAt = Math.min(
    now + CACHE_TTL_MS,
    tokenExpiresAt ?? Number.POSITIVE_INFINITY,
  );
  if (expiresAt <= now) {
    return;
  }
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, entry] of cache) {
      if (entry.expiresAt <= now) {
        cache.delete(k);
      }
    }
  }
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map iterates in insertion order, so the first key is the oldest entry.
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  cache.set(key, { session, expiresAt });
}

/**
 * The engine's decision for this token: the team (the caller's ClickHouse
 * identity) and the session's dashboard role, or a refusal carrying the status
 * to answer with.
 *
 * An engine answer is cached until the sooner of CACHE_TTL_MS and the token's
 * own expiry (`tokenExpiresAt`, epoch ms), and concurrent lookups for one token
 * share a single request. A lookup the engine could not answer - unreachable,
 * timed out, an error status or an unreadable body - is refused with 401 and is
 * never cached, so the next request asks again.
 */
export async function resolveEngineSession(
  token: string,
  tokenExpiresAt?: number,
): Promise<EngineSession> {
  const key = tokenDigest(token);
  const hit = cache.get(key);
  if (hit) {
    if (hit.expiresAt > Date.now()) {
      return hit.session;
    }
    cache.delete(key);
  }

  const inFlight = pending.get(key);
  if (inFlight) {
    return inFlight;
  }

  const lookup = askEngine(token)
    .then(({ session, definitive }) => {
      if (definitive) {
        remember(key, session, tokenExpiresAt);
      }
      return session;
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, lookup);
  return lookup;
}

/** Drop every cached engine answer. */
export function clearEngineSessionCache(): void {
  cache.clear();
  pending.clear();
}
