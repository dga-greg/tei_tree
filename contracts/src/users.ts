import type { PlatformRole } from './roles.js';

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

export interface UserPreferences {
  locale: string;
  theme: ThemePreference;
  defaultFamilyId: string | null;
  /** The welcome tour was finished or skipped, so it is not offered again on any device. */
  tourSeen: boolean;
}

/** The signed-in user's own account, as returned by /auth endpoints. */
export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  platformRole: PlatformRole;
  emailVerified: boolean;
  preferences: UserPreferences;
  security: AccountSecurity;
  /** This device's sign-in. */
  session: { idleTimeoutMinutes: number | null };
  createdAt: string;
}

/** How the account signs in. */
export interface AccountSecurity {
  /** False for accounts made with Google that never set a password. */
  hasPassword: boolean;
  /** Two-step sign-in with an authenticator app. */
  mfaEnabled: boolean;
  /** Platform administrators must turn on two-step sign-in before using the administration pages. */
  mfaRequired: boolean;
  /** The Google account linked for signing in, if any. */
  google: { email: string } | null;
}

/** Account view for platform administrators. Contains no genealogy data. */
export interface AdminUserView {
  id: string;
  email: string;
  displayName: string;
  platformRole: PlatformRole;
  status: UserStatus;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  familyCount: number;
}

export interface AdminUpdateUserRequest {
  status?: Exclude<UserStatus, 'deleted'>;
  platformRole?: PlatformRole;
}

export interface PlatformStats {
  users: { total: number; active: number; suspended: number };
  families: { total: number; active: number };
}
