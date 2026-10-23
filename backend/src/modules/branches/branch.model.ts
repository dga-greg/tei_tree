import { Schema, model, type InferSchemaType } from 'mongoose';
import { softDeleteFields } from '../../core/schemas.js';

/**
 * A named descendant line. Membership is derived by traversing descendants of `foundingMemberId`;
 * people are never copied into a branch, and one person may belong to several branches.
 */
const FamilyBranchSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    foundingMemberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    description: { type: String, default: '', maxlength: 2000 },
    history: { type: String, default: '', maxlength: 50_000 },
    administrators: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    stats: {
      descendantCount: { type: Number, default: 0 },
      generationSpan: { type: Number, default: 0 },
      livingCount: { type: Number, default: 0 },
      recalculatedAt: { type: Date, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'family_branches' },
);

FamilyBranchSchema.index(
  { familyId: 1, foundingMemberId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
FamilyBranchSchema.index({ familyId: 1, name: 1 });

export type FamilyBranch = InferSchemaType<typeof FamilyBranchSchema>;
export const FamilyBranchModel = model('FamilyBranch', FamilyBranchSchema);
