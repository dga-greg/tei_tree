import { Schema, model, type InferSchemaType } from 'mongoose';

/** Result of one generation recalculation, kept for dashboards and trend charts. */
const GenerationSnapshotSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    founderId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', default: null },
    computedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
    totals: {
      members: { type: Number, required: true },
      generations: { type: Number, required: true },
      conflicts: { type: Number, required: true },
      unconnected: { type: Number, required: true },
      marriedIn: { type: Number, required: true },
    },
    byGeneration: {
      type: [
        new Schema(
          {
            number: { type: Number, required: true },
            total: { type: Number, required: true },
            living: { type: Number, required: true },
            deceased: { type: Number, required: true },
            unknown: { type: Number, required: true },
            earliestBirthYear: { type: Number, default: null },
            latestBirthYear: { type: Number, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { collection: 'generation_snapshots' },
);

GenerationSnapshotSchema.index({ familyId: 1, computedAt: -1 });

export type GenerationSnapshot = InferSchemaType<typeof GenerationSnapshotSchema>;
export const GenerationSnapshotModel = model('GenerationSnapshot', GenerationSnapshotSchema);
