// Which request is seeding a team's org connection right now.
//
// The identity middleware seeds any team it finds holding no connection, on
// whichever replica serves the request. The claim here is atomic across
// replicas, so a login's parallel requests never write two connections onto one
// team, and an expired claim is how a failed attempt gets retried. Whether a team
// is seeded is its connections, never this claim, so a deleted connection is
// seeded again. The settled mark only tells other requests when to stop waiting.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import { setTimeout as delay } from 'node:timers/promises';

import mongoose, { Schema } from 'mongoose';

import { isDuplicateKey } from '@/dfe/models/duplicate-key';
import type { ObjectId } from '@/models';

export interface IDfeTeamSeed {
  team: ObjectId;
  claimedAt: Date;
  settledAt?: Date;
}

const DfeTeamSeed = mongoose.model<IDfeTeamSeed>(
  'DfeTeamSeed',
  new Schema<IDfeTeamSeed>(
    {
      team: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
        required: true,
        unique: true,
      },
      claimedAt: {
        type: Date,
        required: true,
      },
      settledAt: {
        type: Date,
      },
    },
    { timestamps: true },
  ),
);

export default DfeTeamSeed;

export type TeamSeedClaim = 'claimed' | 'busy';

/**
 * Claim the right to seed a team, unless another request holds an unexpired
 * claim on it.
 *
 * A lapsed claim is taken in place. Otherwise the insert either creates the one
 * document per team or collides with it on the unique `team` index, and a
 * collision means another request is seeding.
 */
export async function claimTeamSeed(
  teamId: string,
  leaseMs: number,
): Promise<TeamSeedClaim> {
  // Without the unique index built, two first claims both insert.
  await DfeTeamSeed.init();
  const now = new Date();
  const lapsed = await DfeTeamSeed.updateOne(
    {
      team: teamId,
      claimedAt: { $lt: new Date(now.getTime() - leaseMs) },
    },
    { $set: { claimedAt: now } },
  );
  if (lapsed.matchedCount > 0) {
    return 'claimed';
  }
  // An insert, not an upsert: FerretDB answers an upsert collision with InternalError, not a duplicate key.
  try {
    await DfeTeamSeed.create({ team: teamId, claimedAt: now });
    return 'claimed';
  } catch (err) {
    if (isDuplicateKey(err)) {
      return 'busy';
    }
    throw err;
  }
}

/** Mark the team's current seeding attempt finished, whatever its outcome. */
export async function settleTeamSeed(teamId: string): Promise<void> {
  await DfeTeamSeed.updateOne(
    { team: teamId },
    { $set: { settledAt: new Date() } },
  );
}

// How often a waiting request re-reads the claim.
const SEED_POLL_MS = 100;

/**
 * - `idle`: no attempt holds a live claim, so there was nothing to wait for.
 * - `settled`: the attempt holding the claim finished while this one waited.
 * - `timeout`: the claim lapsed unsettled, or the wait outran the lease.
 */
export type TeamSeedWait = 'idle' | 'settled' | 'timeout';

type SeedRecord = Pick<IDfeTeamSeed, 'claimedAt' | 'settledAt'> | null;

function seedState(
  seed: SeedRecord,
  leaseMs: number,
): 'settled' | 'live' | 'lapsed' {
  if (
    seed == null ||
    (seed.settledAt != null && seed.settledAt >= seed.claimedAt)
  ) {
    return 'settled';
  }
  return seed.claimedAt.getTime() > Date.now() - leaseMs ? 'live' : 'lapsed';
}

/**
 * Wait, at most until the claim lapses and never longer than `leaseMs`, for
 * the request seeding the team to settle its claim.
 */
export async function awaitTeamSeed(
  teamId: string,
  leaseMs: number,
): Promise<TeamSeedWait> {
  const readSeed = (): Promise<SeedRecord> =>
    DfeTeamSeed.findOne({ team: teamId }, 'claimedAt settledAt').lean().exec();
  const first = await readSeed();
  if (first == null || seedState(first, leaseMs) !== 'live') {
    return 'idle';
  }
  const deadline = Math.min(
    first.claimedAt.getTime() + leaseMs,
    Date.now() + leaseMs,
  );
  while (Date.now() < deadline) {
    await delay(Math.min(SEED_POLL_MS, deadline - Date.now()));
    const state = seedState(await readSeed(), leaseMs);
    if (state !== 'live') {
      return state === 'settled' ? 'settled' : 'timeout';
    }
  }
  return 'timeout';
}
