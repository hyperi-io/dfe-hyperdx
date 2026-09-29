// The engine's decision on a session, which is where a user's HyperDX team
// comes from.
//
// An engine token's own `groups` claim grants nothing (dfe-engine#591): the
// engine resolves a session's groups from the account the token binds, on every
// request. A HyperDX team is that decision's data-plane face - the team's
// connection is a ClickHouse user - so the team is chosen from what the engine
// answers for the token, never from the claim. Anything short of a readable
// engine answer is a refusal.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { engineOrigin } from '@/dfe/controllers/org-connection';
import logger from '@/utils/logger';

const ENGINE_TIMEOUT_MS = 5000;

// A revoked group or a deleted account reaches HyperDX within this window.
const CACHE_TTL_MS = 30_000;

const CACHE_MAX_ENTRIES = 1000;

/**
 * GET /api/v1/auth/me, read for the two fields the decision needs. `groups` is
 * what the bound account holds, and is empty when the token binds no account.
 */
const EngineSessionSchema = z.object({
  groups: z.array(z.string()),
  password_change_required: z.boolean().optional(),
});

type RefusalReason =
  | 'engine_refused'
  | 'no_group'
  | 'password_change'
  | 'engine_unavailable';

type EngineSession =
  | { granted: true; team: string }
  | { granted: false; status: 401 | 403; reason: RefusalReason };

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

/**
 * The team for the groups the engine grants: the first in code-point order, so
 * the choice never depends on the order the engine lists them in.
 */
function chooseTeam(groups: readonly string[]): string | undefined {
  return [...groups].sort()[0];
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
      return {
        session: {
          granted: false,
          status: resp.status === 401 ? 401 : 403,
          reason: 'engine_refused',
        },
        definitive: true,
      };
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
    if (parsed.data.password_change_required) {
      return {
        session: { granted: false, status: 403, reason: 'password_change' },
        definitive: true,
      };
    }
    const team = chooseTeam(
      parsed.data.groups.map(g => g.trim()).filter(Boolean),
    );
    if (!team) {
      return {
        session: { granted: false, status: 403, reason: 'no_group' },
        definitive: true,
      };
    }
    return { session: { granted: true, team }, definitive: true };
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
 * The engine's decision for this token: the team it selects, or a refusal
 * carrying the status to answer with.
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
