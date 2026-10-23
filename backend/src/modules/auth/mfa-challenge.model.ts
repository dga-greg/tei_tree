import { Schema, model } from 'mongoose';

/** The step between a correct password (or Google) and the authenticator code. Single use, a few minutes. */
const MfaChallengeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    method: { type: String, enum: ['password', 'google'], required: true },
    /** "Keep me signed in on this device", carried to the session. */
    remember: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'mfa_challenges' },
);
MfaChallengeSchema.index({ tokenHash: 1 }, { unique: true });
MfaChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MfaChallengeModel = model('MfaChallenge', MfaChallengeSchema);
