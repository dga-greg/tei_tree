import type { CurrentUser, UserPreferences } from './users.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 80;

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  /** "Keep me signed in on this device": no sign-out when idle. */
  remember?: boolean;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface ChangePasswordRequest {
  /** Not needed by accounts that have no password yet (made with Google). */
  currentPassword?: string;
  newPassword: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  preferences?: Partial<UserPreferences>;
}

export interface AuthResponse {
  user: CurrentUser;
}

/** A correct password on an account with two-step sign-in: the code comes next. */
export interface MfaChallengeResponse {
  mfaRequired: true;
  /** Single use, valid for a few minutes. */
  challenge: string;
  expiresAt: string;
}
export type LoginResponse = AuthResponse | MfaChallengeResponse;
export const isMfaChallenge = (r: LoginResponse): r is MfaChallengeResponse => 'mfaRequired' in r;

/** The second step: a 6-digit code from the authenticator app, or one of the recovery codes. */
export interface MfaVerifyRequest {
  challenge: string;
  code?: string;
  recoveryCode?: string;
}

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  required: boolean;
}

/** A new authenticator secret, waiting for its first code. */
export interface TotpSetupResponse {
  secret: string;
  otpauthUri: string;
  /** The URI as a QR code (SVG markup). */
  qrSvg: string;
}

export interface RecoveryCodesResponse {
  codes: string[];
}

/** Confirms who is changing sign-in settings: the password (if the account has one) and, once on, a code. */
export interface MfaConfirmRequest {
  password?: string;
  code?: string;
  recoveryCode?: string;
}

export const RECOVERY_CODE_COUNT = 10;

export interface CsrfResponse {
  token: string;
}

export interface SessionView {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}
