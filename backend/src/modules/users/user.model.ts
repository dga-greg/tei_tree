import { Schema, model, type InferSchemaType } from 'mongoose';
import { PLATFORM_ROLES, THEMES, USER_STATUSES } from '@fh/contracts';

/** Authentication accounts. Deliberately separate from genealogy profiles (family_members). */
const UserSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    /** Null for accounts made with Google that have not set a password. */
    passwordHash: { type: String, default: null, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    platformRole: { type: String, enum: PLATFORM_ROLES, default: 'user', required: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', required: true },
    emailVerifiedAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: () => new Date() },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    /** Two-step sign-in with an authenticator app. Secrets are encrypted (see auth/secret-box.ts). */
    mfa: {
      totpSecret: { type: String, default: null, select: false },
      enabledAt: { type: Date, default: null },
      /** The last 30-second step a code was accepted for: older and equal codes are refused (no replay). */
      lastUsedStep: { type: Number, default: null },
      recoveryCodes: { type: [{ _id: false, hash: String, usedAt: { type: Date, default: null } }], default: [], select: false },
      /** A secret shown to the person but not confirmed with a code yet. */
      pendingSecret: { type: String, default: null, select: false },
      pendingCreatedAt: { type: Date, default: null },
    },
    /** The Google account used to sign in (OpenID Connect subject), if linked. */
    google: {
      sub: { type: String, default: null },
      email: { type: String, default: null },
      linkedAt: { type: Date, default: null },
    },
    preferences: {
      locale: { type: String, default: 'en', maxlength: 16 },
      theme: { type: String, enum: THEMES, default: 'system' },
      defaultFamilyId: { type: Schema.Types.ObjectId, ref: 'Family', default: null },
      tourSeen: { type: Boolean, default: false },
    },
    /** Reminders: see contracts/src/calendar.ts (NotificationPreferences). Unset means the defaults. */
    notifications: {
      type: new Schema(
        {
          weeklyDigest: { type: Boolean, default: true },
          push: { type: Boolean, default: false },
          kinds: {
            birthday: { type: Boolean, default: true },
            remembrance: { type: Boolean, default: true },
            birth_remembrance: { type: Boolean, default: false },
            anniversary: { type: Boolean, default: true },
            event: { type: Boolean, default: true },
          },
          timezone: { type: String, default: 'UTC', maxlength: 64 },
        },
        { _id: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true, collection: 'users' },
);

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ platformRole: 1, status: 1 });
UserSchema.index({ 'google.sub': 1 }, { unique: true, partialFilterExpression: { 'google.sub': { $type: 'string' } } });

export type User = InferSchemaType<typeof UserSchema>;
export type UserDoc = ReturnType<(typeof UserModel)['hydrate']>;
export const UserModel = model('User', UserSchema);
