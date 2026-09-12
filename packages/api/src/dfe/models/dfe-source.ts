// The DFE source manifest - what the engine has registered, fork side.
//
// The engine pushes one entry per deployed DFE source (PUT /dfe/sources/:name)
// and drops it on delete. Two readers need it: the upsert, to know which sources
// it owns and may replace, and the team-seed path, which creates every
// registered source on a team that did not exist when the engine pushed it.
//
// The engine remains the source of truth. This is a record of what it pushed,
// rebuilt by the next push, and never edited by a human.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import mongoose, { Schema } from 'mongoose';

export interface IDfeSource {
  name: string;
  // The fork SourceSchemaNoId body WITHOUT `connection`, which differs per team.
  spec: Record<string, unknown>;
}

export type DfeSourceDocument = mongoose.HydratedDocument<IDfeSource>;

export default mongoose.model<IDfeSource>(
  'DfeSource',
  new Schema<IDfeSource>(
    {
      name: {
        type: String,
        required: true,
        unique: true,
      },
      spec: {
        type: Schema.Types.Mixed,
        required: true,
      },
    },
    { timestamps: true },
  ),
);
