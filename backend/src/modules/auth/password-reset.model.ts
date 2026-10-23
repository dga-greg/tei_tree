import { Schema, model, type InferSchemaType } from 'mongoose';

const PasswordResetTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String, default: null },
  },
  { timestamps: true, collection: 'password_reset_tokens' },
);

PasswordResetTokenSchema.index({ tokenHash: 1 }, { unique: true });
PasswordResetTokenSchema.index({ userId: 1, usedAt: 1 });
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PasswordResetToken = InferSchemaType<typeof PasswordResetTokenSchema>;
export const PasswordResetTokenModel = model('PasswordResetToken', PasswordResetTokenSchema);
