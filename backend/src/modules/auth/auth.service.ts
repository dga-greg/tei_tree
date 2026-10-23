import mongoose, { Types } from 'mongoose';
import type { SessionView, UpdateProfileRequest } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { randomToken, sha256 } from '../../core/crypto.js';
import { addDays, addMinutes } from '../../core/dates.js';
import type { Logger } from '../../core/logger.js';
import type { EmailDispatcher } from '../../infra/email-dispatcher.js';
import { UserModel, type UserDoc } from '../users/user.model.js';
import { AuthSessionModel, type AuthSessionDoc } from './session.model.js';
import { PasswordResetTokenModel } from './password-reset.model.js';
import type { PasswordHasher } from './password.js';
import type { AccessTokenService } from './tokens.js';
import { passwordChangedEmail, passwordResetEmail, verifyEmailEmail } from './auth.emails.js';
import { EmailVerificationTokenModel } from './email-verification.model.js';
import type { IdentityProof, MfaService } from './mfa.service.js';

export interface AuthSettings {
  appOrigin: string;
  refreshTokenTtlDays: number;
  sessionMaxLifetimeDays: number;
  loginMaxAttempts: number;
  loginLockMinutes: number;
  passwordResetTtlMinutes: number;
  /** 0: no idle sign-out. */
  idleTimeoutMinutes: number;
}

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface IssuedTokens {
  sessionId: Types.ObjectId;
  accessToken: string;
  accessExpiresAt: Date;
  /** Absent when the session was refreshed within the concurrency grace window (see `refresh`). */
  refresh?: { token: string; expiresAt: Date };
}

export interface AuthResult {
  user: UserDoc;
  tokens: IssuedTokens;
}

/** Signing in either starts a session, or (two-step sign-in) asks for a code first. */
export type SignInOutcome = ({ kind: 'session' } & AuthResult) | { kind: 'mfa'; challenge: string; expiresAt: Date };

/** A refresh token rotated out less than this long ago is treated as a benign concurrent refresh. */
const ROTATION_GRACE_MS = 30_000;
const VERIFY_EMAIL_TTL_DAYS = 3;
const PREVIOUS_TOKENS_KEPT = 10;

export class AuthService {
  constructor(
    private readonly settings: AuthSettings,
    private readonly hasher: PasswordHasher,
    private readonly accessTokens: AccessTokenService,
    private readonly email: EmailDispatcher,
    private readonly logger: Logger,
    private readonly mfa: MfaService,
  ) {}

  // ---------------------------------------------------------------- registration & login

  async register(input: { email: string; password: string; displayName: string }, meta: ClientMeta): Promise<AuthResult> {
    const passwordHash = await this.hasher.hash(input.password);
    try {
      return await mongoose.connection.transaction(async (session) => {
        const [user] = await UserModel.create(
          [{ email: input.email, passwordHash, displayName: input.displayName, lastLoginAt: new Date() }],
          { session },
        );
        const tokens = await this.startSession(user!, meta, session);
        return { user: user!, tokens };
      }).then(async (result) => {
        await this.sendVerification(result.user);
        return result;
      });
    } catch (err) {
      if ((err as { code?: unknown }).code === 11000) {
        throw new AppError('EMAIL_TAKEN', 'An account with this e-mail address already exists', [
          { path: 'email', message: 'An account with this e-mail address already exists' },
        ]);
      }
      throw err;
    }
  }

  async login(input: { email: string; password: string; remember?: boolean }, meta: ClientMeta): Promise<SignInOutcome> {
    const user = await UserModel.findOne({ email: input.email }).select('+passwordHash');
    // Accounts made with Google have no password until they set one.
    if (!user || user.status === 'deleted' || !user.passwordHash) {
      await this.hasher.verifyDummy(input.password);
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect e-mail address or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Try again later or reset your password.');
    }

    const valid = await this.hasher.verify(user.passwordHash, input.password);
    if (!valid) {
      await this.recordFailedLogin(user._id);
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect e-mail address or password');
    }

    // Only reveal suspension to someone who proved they know the password.
    if (user.status === 'suspended') {
      throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended. Contact the platform administrator.');
    }

    if (this.hasher.needsRehash(user.passwordHash)) {
      await UserModel.updateOne({ _id: user._id }, { $set: { passwordHash: await this.hasher.hash(input.password) } });
    }
    return this.completeSignIn(user, meta, 'password', input.remember);
  }

  /**
   * After the first factor (a password, or Google): with two-step sign-in on, a short-lived challenge for the
   * code; otherwise a session. Failed-attempt counters are only cleared once sign-in is complete.
   */
  async completeSignIn(user: UserDoc, meta: ClientMeta, method: 'password' | 'google', remember = false): Promise<SignInOutcome> {
    if (user.mfa?.enabledAt) return { kind: 'mfa', ...(await this.mfa.createChallenge(user._id, method, remember)) };
    await UserModel.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return { kind: 'session', user, tokens: await this.startSession(user, meta, undefined, remember) };
  }

  /** The second step: a code from the authenticator app, or a recovery code. Wrong codes count towards the lock. */
  async verifyMfa(challenge: string, proof: IdentityProof, meta: ClientMeta): Promise<AuthResult> {
    const { challengeId, user, remember } = await this.mfa.openChallenge(challenge);
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Try again later or reset your password.');
    }
    if (!(await this.mfa.secondFactor(user, proof))) {
      await this.mfa.failChallenge(challengeId);
      await this.recordFailedLogin(user._id);
      throw new AppError('MFA_INVALID', 'That code is not right. Use the code now showing in your authenticator app, or a recovery code.', [{ path: 'code', message: 'Incorrect code' }]);
    }
    await this.mfa.closeChallenge(challengeId);
    await UserModel.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return { user, tokens: await this.startSession(user, meta, undefined, remember) };
  }

  private async recordFailedLogin(userId: Types.ObjectId): Promise<void> {
    const updated = await UserModel.findOneAndUpdate(
      { _id: userId },
      { $inc: { failedLoginCount: 1 } },
      { new: true, projection: { failedLoginCount: 1 } },
    );
    if (updated && updated.failedLoginCount >= this.settings.loginMaxAttempts) {
      await UserModel.updateOne(
        { _id: userId },
        { $set: { lockedUntil: addMinutes(new Date(), this.settings.loginLockMinutes), failedLoginCount: 0 } },
      );
      this.logger.warn({ userId: userId.toString() }, 'Account temporarily locked after repeated failed sign-ins');
    }
  }

  // ---------------------------------------------------------------- sessions

  /** `remember`: "Keep me signed in on this device", so no idle sign-out. */
  private async startSession(user: UserDoc, meta: ClientMeta, session?: mongoose.ClientSession, remember = false): Promise<IssuedTokens> {
    const now = new Date();
    const refreshToken = randomToken();
    const maxExpiresAt = addDays(now, this.settings.sessionMaxLifetimeDays);
    const expiresAt = this.slidingExpiry(now, maxExpiresAt);
    const [authSession] = await AuthSessionModel.create(
      [
        {
          userId: user._id,
          tokenHash: sha256(refreshToken),
          expiresAt,
          maxExpiresAt,
          userAgent: meta.userAgent?.slice(0, 512) ?? null,
          ip: meta.ip,
          lastUsedAt: now,
          lastActiveAt: now,
          idleTimeoutMinutes: remember || !this.settings.idleTimeoutMinutes ? null : this.settings.idleTimeoutMinutes,
        },
      ],
      { session },
    );
    const access = this.accessTokens.sign(user._id, authSession!._id);
    return { sessionId: authSession!._id, accessToken: access.token, accessExpiresAt: access.expiresAt, refresh: { token: refreshToken, expiresAt } };
  }

  private slidingExpiry(now: Date, maxExpiresAt: Date): Date {
    const sliding = addDays(now, this.settings.refreshTokenTtlDays);
    return sliding < maxExpiresAt ? sliding : maxExpiresAt;
  }

  /**
   * Rotates the refresh token. Presenting a token that was already rotated out (outside a short grace
   * window for concurrent tabs) is treated as theft: the whole session is revoked.
   */
  async refresh(rawToken: string | undefined, meta: ClientMeta): Promise<AuthResult> {
    if (!rawToken) throw new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
    const now = new Date();
    const hash = sha256(rawToken);

    const current = await AuthSessionModel.findOne({ tokenHash: hash, revokedAt: null, expiresAt: { $gt: now } });
    if (current) {
      await this.assertNotIdle(current, now);
      const user = await this.activeUser(current.userId);
      const newToken = randomToken();
      const expiresAt = this.slidingExpiry(now, current.maxExpiresAt);
      // Conditional on the old hash so two concurrent rotations cannot both succeed.
      const rotated = await AuthSessionModel.findOneAndUpdate(
        { _id: current._id, tokenHash: hash, revokedAt: null },
        {
          $set: { tokenHash: sha256(newToken), expiresAt, lastUsedAt: now, ip: meta.ip },
          $push: { previousTokens: { $each: [{ hash, rotatedAt: now }], $slice: -PREVIOUS_TOKENS_KEPT } },
        },
        { new: true },
      );
      if (rotated) {
        const access = this.accessTokens.sign(user._id, rotated._id);
        return { user, tokens: { sessionId: rotated._id, accessToken: access.token, accessExpiresAt: access.expiresAt, refresh: { token: newToken, expiresAt } } };
      }
      // Lost the race to a concurrent refresh: fall through to the previous-token path.
    }

    const previous = await AuthSessionModel.findOne({ 'previousTokens.hash': hash });
    if (!previous || previous.revokedAt || previous.expiresAt <= now) {
      throw new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
    }
    const entry = previous.previousTokens.find((t) => t.hash === hash);
    if (entry && now.getTime() - entry.rotatedAt.getTime() <= ROTATION_GRACE_MS) {
      // Another tab refreshed a moment ago and the browser already holds the new refresh cookie.
      const user = await this.activeUser(previous.userId);
      const access = this.accessTokens.sign(user._id, previous._id);
      return { user, tokens: { sessionId: previous._id, accessToken: access.token, accessExpiresAt: access.expiresAt } };
    }

    await this.revokeSessionDoc(previous, 'refresh_token_reuse');
    this.logger.warn({ userId: previous.userId.toString(), sessionId: previous.id }, 'Refresh token reuse detected; session revoked');
    throw new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
  }

  /** Ends a session left unused longer than its idle limit. */
  private async assertNotIdle(session: AuthSessionDoc, now: Date): Promise<void> {
    const limit = session.idleTimeoutMinutes;
    const last = session.lastActiveAt ?? session.lastUsedAt;
    if (!limit || !last || now.getTime() - last.getTime() <= limit * 60_000) return;
    await this.revokeSessionDoc(session, 'idle');
    throw new AppError('SESSION_EXPIRED', 'You were signed out after a period of inactivity. Please sign in again.');
  }

  /** The app reports that the person is using it, which keeps an idle limit from running out. */
  async recordActivity(sessionId: Types.ObjectId): Promise<void> {
    const session = await AuthSessionModel.findOne({ _id: sessionId, revokedAt: null });
    if (!session) throw new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
    const now = new Date();
    await this.assertNotIdle(session, now);
    await AuthSessionModel.updateOne({ _id: session._id }, { $set: { lastActiveAt: now } });
  }

  /** The idle limit of a session, in minutes; null when there is none. */
  async idleLimit(sessionId: Types.ObjectId | undefined): Promise<number | null> {
    if (!sessionId) return null;
    const session = await AuthSessionModel.findById(sessionId, { idleTimeoutMinutes: 1 }).lean();
    return session?.idleTimeoutMinutes ?? null;
  }

  private async activeUser(userId: Types.ObjectId): Promise<UserDoc> {
    const user = await UserModel.findById(userId);
    if (!user || user.status !== 'active') {
      throw new AppError('SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
    }
    return user;
  }

  private async revokeSessionDoc(session: AuthSessionDoc, reason: string): Promise<void> {
    await AuthSessionModel.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  }

  /** Signs out the current device, identified by the access-token session or the refresh cookie. */
  async logout(sessionId: Types.ObjectId | undefined, rawRefreshToken: string | undefined): Promise<void> {
    const filter = sessionId
      ? { _id: sessionId }
      : rawRefreshToken
        ? { tokenHash: sha256(rawRefreshToken) }
        : null;
    if (!filter) return;
    await AuthSessionModel.updateOne({ ...filter, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
  }

  async revokeAllSessions(userId: Types.ObjectId, reason: string, exceptSessionId?: Types.ObjectId, session?: mongoose.ClientSession): Promise<void> {
    await AuthSessionModel.updateMany(
      { userId, revokedAt: null, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
      { session },
    );
  }

  async listSessions(userId: Types.ObjectId, currentSessionId: Types.ObjectId): Promise<SessionView[]> {
    const sessions = await AuthSessionModel.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 });
    return sessions.map((s) => ({
      id: s.id as string,
      userAgent: s.userAgent ?? null,
      ip: s.ip ?? null,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s._id.equals(currentSessionId),
    }));
  }

  async revokeSession(userId: Types.ObjectId, sessionId: Types.ObjectId): Promise<void> {
    const result = await AuthSessionModel.updateOne(
      { _id: sessionId, userId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'revoked_by_user' } },
    );
    if (result.matchedCount === 0) throw AppError.notFound('Session');
  }

  // ---------------------------------------------------------------- password recovery

  /** Always succeeds from the caller's point of view, so it cannot be used to discover accounts. */
  async forgotPassword(email: string, meta: ClientMeta): Promise<void> {
    const user = await UserModel.findOne({ email, status: 'active' });
    if (!user) return;

    const token = randomToken();
    await PasswordResetTokenModel.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
    await PasswordResetTokenModel.create({
      userId: user._id,
      tokenHash: sha256(token),
      expiresAt: addMinutes(new Date(), this.settings.passwordResetTtlMinutes),
      requestedIp: meta.ip,
    });
    const url = new URL('/auth/reset-password', this.settings.appOrigin);
    url.searchParams.set('token', token);
    this.email.dispatch(passwordResetEmail(user.email, user.displayName, url.toString(), this.settings.passwordResetTtlMinutes));
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const passwordHash = await this.hasher.hash(newPassword);
    const user = await mongoose.connection.transaction(async (session) => {
      const token = await PasswordResetTokenModel.findOneAndUpdate(
        { tokenHash: sha256(rawToken), usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true, session },
      );
      if (!token) {
        throw new AppError('VALIDATION_FAILED', 'This reset link is invalid or has expired. Request a new one.', [
          { path: 'token', message: 'Invalid or expired reset link' },
        ]);
      }
      const updated = await UserModel.findOneAndUpdate(
        { _id: token.userId, status: 'active' },
        { $set: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } },
        { new: true, session },
      );
      if (!updated) throw new AppError('VALIDATION_FAILED', 'This reset link is invalid or has expired. Request a new one.');
      await this.revokeAllSessions(updated._id, 'password_reset', undefined, session);
      return updated;
    });
    this.email.dispatch(passwordChangedEmail(user.email, user.displayName));
  }

  /** Changes the password, or sets a first one on an account made with Google (which needs a recent sign-in). */
  async changePassword(userId: Types.ObjectId, currentSessionId: Types.ObjectId, currentPassword: string | undefined, newPassword: string): Promise<void> {
    const user = await UserModel.findById(userId).select('+passwordHash');
    if (!user) throw AppError.unauthenticated();
    if (user.passwordHash) {
      if (!currentPassword || !(await this.hasher.verify(user.passwordHash, currentPassword))) {
        throw new AppError('VALIDATION_FAILED', 'Your current password is incorrect', [
          { path: 'currentPassword', message: 'Incorrect password' },
        ]);
      }
    } else {
      await this.mfa.confirmIdentity(userId, currentSessionId, {}, false);
    }
    const passwordHash = await this.hasher.hash(newPassword);
    await mongoose.connection.transaction(async (session) => {
      await UserModel.updateOne({ _id: userId }, { $set: { passwordHash, passwordChangedAt: new Date() } }, { session });
      await this.revokeAllSessions(userId, 'password_changed', currentSessionId, session);
    });
    this.email.dispatch(passwordChangedEmail(user.email, user.displayName));
  }

  // ---------------------------------------------------------------- e-mail verification

  /** Issues a new single-use link (older unused links stop working) and e-mails it. */
  async sendVerification(user: UserDoc): Promise<void> {
    if (user.emailVerifiedAt) return;
    const token = randomToken();
    await EmailVerificationTokenModel.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: new Date() } });
    await EmailVerificationTokenModel.create({ userId: user._id, email: user.email, tokenHash: sha256(token), expiresAt: addDays(new Date(), VERIFY_EMAIL_TTL_DAYS) });
    const url = new URL('/auth/verify-email', this.settings.appOrigin);
    url.searchParams.set('token', token);
    this.email.dispatch(verifyEmailEmail(user.email, user.displayName, url.toString()));
  }

  async resendVerification(userId: Types.ObjectId): Promise<void> {
    const user = await UserModel.findById(userId);
    if (!user) throw AppError.unauthenticated();
    if (user.emailVerifiedAt) throw new AppError('CONFLICT', 'Your e-mail address is already confirmed');
    await this.sendVerification(user);
  }

  async verifyEmail(rawToken: string): Promise<UserDoc> {
    const token = await EmailVerificationTokenModel.findOneAndUpdate(
      { tokenHash: sha256(rawToken), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    );
    const invalid = new AppError('VALIDATION_FAILED', 'This confirmation link is invalid or has expired. Request a new one from your settings.', [
      { path: 'token', message: 'Invalid or expired link' },
    ]);
    if (!token) throw invalid;
    // The link only confirms the address it was sent to.
    const user = await UserModel.findOneAndUpdate({ _id: token.userId, email: token.email, status: 'active' }, { $set: { emailVerifiedAt: new Date() } }, { new: true });
    if (!user) throw invalid;
    return user;
  }

  // ---------------------------------------------------------------- profile

  async updateProfile(userId: Types.ObjectId, patch: UpdateProfileRequest): Promise<UserDoc> {
    const set: Record<string, unknown> = {};
    if (patch.displayName !== undefined) set['displayName'] = patch.displayName;
    for (const [key, value] of Object.entries(patch.preferences ?? {})) {
      if (value !== undefined) set[`preferences.${key}`] = key === 'defaultFamilyId' && typeof value === 'string' ? new Types.ObjectId(value) : value;
    }
    const user = await UserModel.findOneAndUpdate({ _id: userId, status: 'active' }, { $set: set }, { new: true, runValidators: true });
    if (!user) throw AppError.unauthenticated();
    return user;
  }
}
