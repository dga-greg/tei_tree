import { Schema, model, type InferSchemaType } from 'mongoose';

export const CONTRIBUTION_KINDS = [
  'member.create',
  'member.update',
  'member.delete',
  'relationship.create',
  'relationship.update',
  'relationship.delete',
  'media.attach',
  'story.create',
  'claim.profile',
] as const;

export const CONTRIBUTION_STATUSES = ['pending', 'needs_clarification', 'approved', 'rejected', 'withdrawn'] as const;

/** A proposed change awaiting review. Applying an approved contribution writes an audit log entry. */
const FamilyContributionSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    kind: { type: String, enum: CONTRIBUTION_KINDS, required: true },
    targetType: { type: String, enum: ['member', 'relationship', 'media', 'story', 'family'], required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    /** Branches the target belongs to, for moderator scoping. */
    branchIds: { type: [Schema.Types.ObjectId], default: [] },
    payload: { type: Schema.Types.Mixed, required: true },
    /** Snapshot of the target's values at proposal time, used to detect conflicting edits. */
    previousValues: { type: Schema.Types.Mixed, default: null },
    targetVersion: { type: Number, default: null },
    status: { type: String, enum: CONTRIBUTION_STATUSES, default: 'pending' },
    proposedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', maxlength: 5000 },
    discussion: {
      type: [
        new Schema(
          {
            by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            message: { type: String, required: true, maxlength: 5000 },
            at: { type: Date, default: () => new Date() },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    appliedAuditId: { type: Schema.Types.ObjectId, ref: 'AuditLog', default: null },
  },
  { timestamps: true, collection: 'family_contributions', optimisticConcurrency: true, versionKey: 'version' },
);

FamilyContributionSchema.index({ familyId: 1, status: 1, createdAt: -1 });
FamilyContributionSchema.index({ familyId: 1, proposedBy: 1, createdAt: -1 });
FamilyContributionSchema.index({ familyId: 1, targetType: 1, targetId: 1 });

export type FamilyContribution = InferSchemaType<typeof FamilyContributionSchema>;
export const FamilyContributionModel = model('FamilyContribution', FamilyContributionSchema);
