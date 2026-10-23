import { Schema, model, type InferSchemaType } from 'mongoose';
import { FAMILY_ROLES } from '@fh/contracts';

/** Links an authentication account to a family with a role, and optionally to a claimed profile. */
const FamilyMembershipSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: FAMILY_ROLES, required: true, default: 'family_member' },
    /** Only meaningful for moderators. Empty = all branches. */
    moderatedBranchIds: { type: [Schema.Types.ObjectId], ref: 'FamilyBranch', default: [] },
    /** The family's treasurer (or one of them): manages family funds whatever their role. */
    treasurer: { type: Boolean, default: false },
    /** Person record this account has claimed (set only after verification by an administrator). */
    memberProfileId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', default: null },
    status: { type: String, enum: ['active', 'removed'], default: 'active' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    joinedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'family_memberships' },
);

FamilyMembershipSchema.index({ familyId: 1, userId: 1 }, { unique: true });
FamilyMembershipSchema.index({ userId: 1, status: 1 });
FamilyMembershipSchema.index({ familyId: 1, role: 1, status: 1 });
FamilyMembershipSchema.index(
  { familyId: 1, memberProfileId: 1 },
  { unique: true, partialFilterExpression: { memberProfileId: { $type: 'objectId' }, status: 'active' } },
);

export type FamilyMembership = InferSchemaType<typeof FamilyMembershipSchema>;
export type FamilyMembershipDoc = ReturnType<(typeof FamilyMembershipModel)['hydrate']>;
export const FamilyMembershipModel = model('FamilyMembership', FamilyMembershipSchema);
