// Whether a team holds its org connection, and which request is seeding it now.
//
// The identity middleware keeps trying to seed a team until one attempt lands,
// on whichever replica serves the request. The claim here is atomic across
// replicas, so a login's parallel requests never write two connections onto one
// team, and an expired claim is how a failed attempt gets retried.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import mongoose, { Schema } from 'mongoose';

import { isDuplicateKey } from '@/dfe/models/duplicate-key';
import type { ObjectId } from '@/models';

export interface IDfeTeamSeed {
  team: ObjectId;
  claimedAt: Date;
  seededAt: Date | null;
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
      seededAt: {
        type: Date,
        default: null,
      },
    },
    { timestamps: true },
  ),
);

export default DfeTeamSeed;

export type TeamSeedClaim = 'claimed' | 'seeded' | 'busy';

/**
 * Claim the right to seed a team, unless it is seeded or another request holds
 * an unexpired claim on it.
 *
 * The upsert either takes the one document per team or collides with it on the
 * unique `team` index, and a collision is read back to tell a seeded team from
 * one another request is still seeding.
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
        seededAt: null,
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
  const seed = await DfeTeamSeed.findOne({ team: teamId })
    .select('seededAt')
    .lean();
  return seed?.seededAt ? 'seeded' : 'busy';
}

/** Record that the team holds its connection, so no request seeds it again. */
export async function markTeamSeeded(teamId: string): Promise<void> {
  await DfeTeamSeed.updateOne(
    { team: teamId },
    { $set: { seededAt: new Date() } },
  );
}
