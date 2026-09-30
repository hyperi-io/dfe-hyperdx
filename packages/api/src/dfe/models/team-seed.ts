// Which request is seeding a team's org connection right now.
//
// The identity middleware seeds any team it finds holding no connection, on
// whichever replica serves the request. The claim here is atomic across
// replicas, so a login's parallel requests never write two connections onto one
// team, and an expired claim is how a failed attempt gets retried. Whether a team
// is seeded is its connections, never this claim, so a deleted connection is
// seeded again.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import mongoose, { Schema } from 'mongoose';

import { isDuplicateKey } from '@/dfe/models/duplicate-key';
import type { ObjectId } from '@/models';

export interface IDfeTeamSeed {
  team: ObjectId;
  claimedAt: Date;
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
 * The upsert either takes the one document per team or collides with it on the
 * unique `team` index, and a collision means another request is seeding.
 */
export async function claimTeamSeed(
  teamId: string,
  leaseMs: number,
): Promise<TeamSeedClaim> {
  // Without the unique index built, two first claims both insert.
  await DfeTeamSeed.init();
  const now = new Date();
  try {
    await DfeTeamSeed.findOneAndUpdate(
      {
        team: teamId,
        claimedAt: { $lt: new Date(now.getTime() - leaseMs) },
      },
      { $set: { claimedAt: now } },
      { upsert: true },
    );
    return 'claimed';
  } catch (err) {
    if (!isDuplicateKey(err)) {
      throw err;
    }
  }
  return 'busy';
}
