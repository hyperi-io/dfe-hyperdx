// A shipped dashboard a team deleted, remembered so the provisioner leaves it deleted.
//
// The provisioner upserts by {name, team} once a minute, so a delete with no
// record of it undoes itself within 60s. The tombstone outlives an engine
// upgrade too: a newer shipped version of a deleted dashboard stays deleted
// until the team restores it.
//
// The query helpers live beside the schema rather than in a controller so the
// provisioner does not import the module that imports the provisioner.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import mongoose, { Schema } from 'mongoose';

import type { ObjectId } from '@/models';

export interface IDfeDashboardTombstone {
  name: string;
  team: ObjectId;
  deletedAt: Date;
}

export type DfeDashboardTombstoneDocument =
  mongoose.HydratedDocument<IDfeDashboardTombstone>;

const DfeDashboardTombstone = mongoose.model<IDfeDashboardTombstone>(
  'DfeDashboardTombstone',
  new Schema<IDfeDashboardTombstone>(
    {
      name: {
        type: String,
        required: true,
      },
      team: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team',
        required: true,
      },
      deletedAt: {
        type: Date,
        required: true,
      },
    },
    { timestamps: true },
  ).index({ name: 1, team: 1 }, { unique: true }),
);

export default DfeDashboardTombstone;

/** Remember that this team deleted the shipped dashboard called `name`. */
export async function recordDashboardTombstone(
  name: string,
  teamId: string,
): Promise<void> {
  await DfeDashboardTombstone.findOneAndUpdate(
    { name, team: teamId },
    { $set: { deletedAt: new Date() } },
    { upsert: true },
  );
}

/** The shipped dashboard names this team has deleted. */
export async function suppressedDashboardNames(
  teamId: string,
): Promise<Set<string>> {
  const tombstones = await DfeDashboardTombstone.find({ team: teamId })
    .select('name')
    .lean();
  return new Set(tombstones.map(t => t.name));
}

/** Forget every deletion this team recorded. Returns how many were cleared. */
export async function clearDashboardTombstones(
  teamId: string,
): Promise<number> {
  const result = await DfeDashboardTombstone.deleteMany({ team: teamId });
  return result.deletedCount ?? 0;
}
