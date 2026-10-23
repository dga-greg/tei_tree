import { Schema, model, type InferSchemaType } from 'mongoose';
import { FAMILY_STATUSES, FAMILY_VISIBILITIES } from '@fh/contracts';

const FamilySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 140 },
    description: { type: String, default: '', maxlength: 2000 },
    history: { type: String, default: '', maxlength: 50_000 },
    emblemMediaId: { type: Schema.Types.ObjectId, ref: 'FamilyMedia', default: null },
    /** Generation 1. All generation numbers are relative to this person. */
    foundingMemberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', default: null },
    origin: {
      hometown: { type: String, default: '', maxlength: 120 },
      region: { type: String, default: '', maxlength: 120 },
      country: { type: String, default: '', maxlength: 120 },
    },
    privacy: {
      visibility: { type: String, enum: FAMILY_VISIBILITIES, default: 'private' },
      showLivingToMembers: { type: Boolean, default: true },
      allowMemberUploads: { type: Boolean, default: true },
      requireApprovalForMemberEdits: { type: Boolean, default: true },
    },
    generationPolicy: {
      countAdoptive: { type: Boolean, default: true },
    },
    /** Lines through the mother and the father (see contracts/src/lineage.ts). */
    lineage: {
      maternal: {
        enabled: { type: Boolean, default: true },
        label: { type: String, default: 'Abusua', trim: true, maxlength: 40 },
      },
      paternal: {
        enabled: { type: Boolean, default: true },
        label: { type: String, default: 'Ntoro', trim: true, maxlength: 40 },
      },
      totemFollows: { type: String, enum: ['maternal', 'paternal'], default: 'maternal' },
      throughAdoption: { type: Boolean, default: false },
    },
    /** How announcements begin and end (see contracts/src/announcements.ts). Unset means the defaults. */
    messageTemplate: {
      opening: { type: String, trim: true, maxlength: 80 },
      signOff: { type: String, trim: true, maxlength: 80 },
    },
    status: { type: String, enum: FAMILY_STATUSES, default: 'active' },
    /** Set when an administrator deletes the family; the purge job erases it after this date. */
    deletionScheduledFor: { type: Date, default: null },
    deletionRequestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Cache maintained by background jobs; never edited directly. */
    stats: {
      memberCount: { type: Number, default: 0 },
      generationCount: { type: Number, default: 0 },
      branchCount: { type: Number, default: 0 },
      livingCount: { type: Number, default: 0 },
      deceasedCount: { type: Number, default: 0 },
      recalculatedAt: { type: Date, default: null },
    },
    /**
     * Incremented by every relationship write inside its transaction. Concurrent relationship
     * changes in one family therefore conflict and are serialised, so integrity checks such as
     * cycle detection cannot be bypassed by two simultaneous requests.
     */
    graphRevision: { type: Number, default: 0 },
    /** Incremented whenever people are added, edited, removed or restored. */
    peopleRevision: { type: Number, default: 0 },
    /** Progress of generation recalculation, shown in the UI ("Recalculating…"). */
    generationState: {
      status: { type: String, enum: ['idle', 'pending', 'running'], default: 'idle' },
      requestedAt: { type: Date, default: null },
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'families', optimisticConcurrency: true, versionKey: 'version' },
);

FamilySchema.index({ slug: 1 }, { unique: true });
FamilySchema.index({ 'privacy.visibility': 1, status: 1 });
FamilySchema.index({ createdBy: 1 });

export type Family = InferSchemaType<typeof FamilySchema>;
export type FamilyDoc = ReturnType<(typeof FamilyModel)['hydrate']>;
export const FamilyModel = model('Family', FamilySchema);
