// MongoDB's duplicate-key error, raised when concurrent inserts collide on a
// unique index. DocumentDB surfaces the same code.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import { withRetry } from '@/utils/retry';

const DUPLICATE_KEY = 11000;

// DocumentDB's WriteConflict. It and 11000 are what the loser of two upserts
// inserting one key gets there, where MongoDB retries the loser itself.
const WRITE_CONFLICT = 112;

export function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === DUPLICATE_KEY
  );
}

/**
 * Run an upsert on a unique key, retrying a lost insert race a few times with
 * short jittered backoff before rethrowing. The retry finds the winner's
 * document and updates it.
 */
export function retryUpsertRace<T>(upsert: () => Promise<T>): Promise<T> {
  return withRetry(upsert, {
    maxRetries: 4,
    initialDelayMs: 20,
    maxDelayMs: 200,
    retryOnlyOnStatus: [DUPLICATE_KEY, WRITE_CONFLICT],
  });
}
