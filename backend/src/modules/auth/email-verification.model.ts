import { Schema, model, type InferSchemaType } from 'mongoose';

/** Proof-of-ownership tokens for account e-mail addresses (stored hashed). */
const EmailVerificationTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'email_verification_tokens' },
);

EmailVerificationTokenSchema.index({ tokenHash: 1 }, { unique: true });
EmailVerificationTokenSchema.index({ userId: 1, usedAt: 1 });
EmailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type EmailVerificationToken = InferSchemaType<typeof EmailVerificationTokenSchema>;
export const EmailVerificationTokenModel = model('EmailVerificationToken', EmailVerificationTokenSchema);
