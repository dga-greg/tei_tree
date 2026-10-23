import { Schema, model, type InferSchemaType } from 'mongoose';
import { FAMILY_ROLES } from '@fh/contracts';

const FamilyInvitationSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    tokenHash: { type: String, required: true },
    role: { type: String, enum: FAMILY_ROLES, default: 'family_member' },
    /** A profile the invitee may claim; the claim itself still requires administrator verification. */
    suggestedProfileId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', default: null },
    message: { type: String, default: '', maxlength: 2000 },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'revoked', 'expired'], default: 'pending' },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acceptedAt: { type: Date, default: null },
    /** Removal date for housekeeping (expiry + retention period). */
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'family_invitations' },
);

FamilyInvitationSchema.index({ tokenHash: 1 }, { unique: true });
FamilyInvitationSchema.index({ familyId: 1, email: 1, status: 1 });
FamilyInvitationSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export type FamilyInvitation = InferSchemaType<typeof FamilyInvitationSchema>;
export const FamilyInvitationModel = model('FamilyInvitation', FamilyInvitationSchema);
