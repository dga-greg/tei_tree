import type { AdminUserView, CurrentUser } from '@fh/contracts';
import { iso } from '../../core/dates.js';
import type { UserDoc } from './user.model.js';

/** `hasPassword` is passed in because the password hash is never loaded with the account. */
export function toCurrentUser(user: UserDoc, security: { hasPassword: boolean; mfaRequired: boolean }, session: CurrentUser['session'] = { idleTimeoutMinutes: null }): CurrentUser {
  return {
    id: user.id as string,
    email: user.email,
    displayName: user.displayName,
    platformRole: user.platformRole,
    emailVerified: user.emailVerifiedAt != null,
    preferences: {
      locale: user.preferences?.locale ?? 'en',
      theme: user.preferences?.theme ?? 'system',
      defaultFamilyId: user.preferences?.defaultFamilyId?.toString() ?? null,
      tourSeen: user.preferences?.tourSeen ?? false,
    },
    security: {
      hasPassword: security.hasPassword,
      mfaEnabled: !!user.mfa?.enabledAt,
      mfaRequired: security.mfaRequired,
      google: user.google?.sub ? { email: user.google.email ?? '' } : null,
    },
    session,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toAdminUserView(user: UserDoc, familyCount: number): AdminUserView {
  return {
    id: user.id as string,
    email: user.email,
    displayName: user.displayName,
    platformRole: user.platformRole,
    status: user.status,
    emailVerified: user.emailVerifiedAt != null,
    lastLoginAt: iso(user.lastLoginAt),
    createdAt: user.createdAt.toISOString(),
    familyCount,
  };
}
