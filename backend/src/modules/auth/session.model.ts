import { Schema, model, type InferSchemaType } from 'mongoose';

/** One document per signed-in device. Holds the hash of the current refresh token. */
const AuthSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    /** Recently rotated-out token hashes, kept to detect refresh-token replay. */
    previousTokens: {
      type: [new Schema({ hash: { type: String, required: true }, rotatedAt: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
    expiresAt: { type: Date, required: true },
    /** Hard upper bound on the session lifetime regardless of activity. */
    maxExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 512 },
    ip: { type: String, default: null, maxlength: 64 },
    lastUsedAt: { type: Date, default: () => new Date() },
    /** Signed out after this long without the person using the app; null when they chose to stay signed in. */
    idleTimeoutMinutes: { type: Number, default: null },
    /** Last time the person used the app (sign-in, or activity reported by the app). Background requests do not count. */
    lastActiveAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, collection: 'auth_sessions' },
);

AuthSessionSchema.index({ tokenHash: 1 }, { unique: true });
AuthSessionSchema.index({ 'previousTokens.hash': 1 });
AuthSessionSchema.index({ userId: 1, revokedAt: 1 });
// MongoDB removes sessions automatically once they expire.
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthSession = InferSchemaType<typeof AuthSessionSchema>;
export type AuthSessionDoc = ReturnType<(typeof AuthSessionModel)['hydrate']>;
export const AuthSessionModel = model('AuthSession', AuthSessionSchema);
