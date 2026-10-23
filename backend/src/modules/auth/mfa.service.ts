import type { Types } from 'mongoose';
import QRCode from 'qrcode';
import { RECOVERY_CODE_COUNT, type MfaStatus, type TotpSetupResponse } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { randomToken, sha256 } from '../../core/crypto.js';
import { addMinutes } from '../../core/dates.js';
import type { EmailDispatcher } from '../../infra/email-dispatcher.js';
import { UserModel, type UserDoc } from '../users/user.model.js';
import { mfaDisabledEmail, mfaEnabledEmail, recoveryCodeUsedEmail } from './auth.emails.js';
import { MfaChallengeModel } from './mfa-challenge.model.js';
import type { PasswordHasher } from './password.js';
import type { SecretBox } from './secret-box.js';
import { AuthSessionModel } from './session.model.js';
import { generateTotpSecret, normaliseRecoveryCode, otpauthUri, recoveryCode, verifyTotp } from './totp.js';

export interface MfaSettings {
  issuer: string;
  /** Platform administrators must have two-step sign-in to use the administration pages. */
  adminRequired: boolean;
}

/** What someone gives to prove it is them: their password, and once two-step sign-in is on, a code. */
export interface IdentityProof {
  password?: string;
  code?: string;
  recoveryCode?: string;
}

const CHALLENGE_MINUTES = 5;
const CHALLENGE_ATTEMPTS = 5;
const SETUP_MINUTES = 15;
/** Accounts without a password (made with Google) confirm changes by having signed in this recently. */
const RECENT_SIGN_IN_MINUTES = 15;
const SECRETS = '+passwordHash +mfa.totpSecret +mfa.recoveryCodes +mfa.pendingSecret';

/**
 * Two-step sign-in with an authenticator app (TOTP) and single-use recovery codes. Secrets are encrypted at
 * rest; each code works once (the last accepted step is remembered); every change is e-mailed to the person.
 */
export class MfaService {
  constructor(
    private readonly settings: MfaSettings,
    private readonly box: SecretBox,
    private readonly hasher: PasswordHasher,
    private readonly email: EmailDispatcher,
  ) {}

  required(user: Pick<UserDoc, 'platformRole'>): boolean {
    return this.settings.adminRequired && user.platformRole === 'super_admin';
  }

  private async load(userId: Types.ObjectId): Promise<UserDoc> {
    const user = await UserModel.findOne({ _id: userId, status: 'active' }).select(SECRETS);
    if (!user) throw AppError.unauthenticated();
    return user;
  }

  async status(userId: Types.ObjectId): Promise<MfaStatus> {
    const user = await this.load(userId);
    return {
      enabled: !!user.mfa?.enabledAt,
      enabledAt: user.mfa?.enabledAt?.toISOString() ?? null,
      recoveryCodesLeft: (user.mfa?.recoveryCodes ?? []).filter((c) => !c.usedAt).length,
      required: this.required(user),
    };
  }

  /**
   * Checks that the person at the keyboard is the account holder before a sensitive change: the password, or
   * for accounts without one a recent sign-in; and with `needCode`, a code when two-step sign-in is on.
   */
  async confirmIdentity(userId: Types.ObjectId, sessionId: Types.ObjectId | undefined, proof: IdentityProof, needCode: boolean): Promise<UserDoc> {
    const user = await this.load(userId);
    if (user.passwordHash) {
      if (!proof.password || !(await this.hasher.verify(user.passwordHash, proof.password))) {
        throw new AppError('VALIDATION_FAILED', 'The password is not correct', [{ path: 'password', message: 'Incorrect password' }]);
      }
    } else {
      const session = sessionId ? await AuthSessionModel.findOne({ _id: sessionId, userId, revokedAt: null }, { createdAt: 1 }) : null;
      if (!session || session.createdAt < addMinutes(new Date(), -RECENT_SIGN_IN_MINUTES)) {
        throw new AppError('FORBIDDEN', `To keep your account safe, sign out and sign in again with Google, then try again within ${RECENT_SIGN_IN_MINUTES} minutes.`);
      }
    }
    if (needCode && user.mfa?.enabledAt && !(await this.secondFactor(user, proof))) {
      throw new AppError('MFA_INVALID', 'That code is not right. Use the current code from your authenticator app, or a recovery code.', [{ path: 'code', message: 'Incorrect code' }]);
    }
    return user;
  }

  /**
   * Accepts a current authenticator code (never the same one twice) or an unused recovery code, and records
   * its use. Both updates are conditional, so two requests racing with one code cannot both succeed.
   */
  async secondFactor(user: UserDoc, proof: IdentityProof): Promise<boolean> {
    if (proof.code && user.mfa?.totpSecret) {
      const step = verifyTotp(this.box.open(user.mfa.totpSecret), proof.code, user.mfa.lastUsedStep ?? null);
      if (step === null) return false;
      const res = await UserModel.updateOne(
        { _id: user._id, $or: [{ 'mfa.lastUsedStep': null }, { 'mfa.lastUsedStep': { $lt: step } }] },
        { $set: { 'mfa.lastUsedStep': step } },
      );
      return res.modifiedCount === 1;
    }
    if (proof.recoveryCode) {
      const hash = this.box.mac(normaliseRecoveryCode(proof.recoveryCode));
      const res = await UserModel.updateOne(
        { _id: user._id, 'mfa.recoveryCodes': { $elemMatch: { hash, usedAt: null } } },
        { $set: { 'mfa.recoveryCodes.$.usedAt': new Date() } },
      );
      if (res.modifiedCount !== 1) return false;
      const left = (user.mfa?.recoveryCodes ?? []).filter((c) => !c.usedAt && c.hash !== hash).length;
      this.email.dispatch(recoveryCodeUsedEmail(user.email, user.displayName, left));
      return true;
    }
    return false;
  }

  private newRecoveryCodes(): { codes: string[]; stored: { hash: string; usedAt: null }[] } {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
    return { codes, stored: codes.map((c) => ({ hash: this.box.mac(c), usedAt: null })) };
  }

  // ------------------------------------------------------------------ turning it on and off

  async setup(userId: Types.ObjectId, sessionId: Types.ObjectId, proof: IdentityProof): Promise<TotpSetupResponse> {
    const user = await this.confirmIdentity(userId, sessionId, proof, false);
    if (user.mfa?.enabledAt) throw new AppError('CONFLICT', 'Two-step sign-in is already on');
    const secret = generateTotpSecret();
    await UserModel.updateOne({ _id: userId }, { $set: { 'mfa.pendingSecret': this.box.seal(secret), 'mfa.pendingCreatedAt': new Date() } });
    const uri = otpauthUri(secret, user.email, this.settings.issuer);
    return { secret, otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }) };
  }

  /** Confirms the new secret with its first code; returns the recovery codes, shown once. */
  async enable(userId: Types.ObjectId, code: string): Promise<string[]> {
    const user = await this.load(userId);
    if (user.mfa?.enabledAt) throw new AppError('CONFLICT', 'Two-step sign-in is already on');
    const pending = user.mfa?.pendingSecret;
    if (!pending || !user.mfa?.pendingCreatedAt || user.mfa.pendingCreatedAt < addMinutes(new Date(), -SETUP_MINUTES)) {
      throw new AppError('CONFLICT', 'This set-up has expired. Start again to get a new QR code.');
    }
    const secret = this.box.open(pending);
    const step = verifyTotp(secret, code, null);
    if (step === null) {
      throw new AppError('MFA_INVALID', 'That code is not right. Check the time on your phone is set automatically, and type the code now showing.', [{ path: 'code', message: 'Incorrect code' }]);
    }
    const { codes, stored } = this.newRecoveryCodes();
    const res = await UserModel.updateOne(
      { _id: userId, 'mfa.enabledAt': null, 'mfa.pendingSecret': pending },
      { $set: { 'mfa.totpSecret': pending, 'mfa.enabledAt': new Date(), 'mfa.lastUsedStep': step, 'mfa.recoveryCodes': stored, 'mfa.pendingSecret': null, 'mfa.pendingCreatedAt': null } },
    );
    if (res.modifiedCount !== 1) throw new AppError('CONFLICT', 'Two-step sign-in was changed meanwhile. Reload and try again.');
    this.email.dispatch(mfaEnabledEmail(user.email, user.displayName));
    return codes;
  }

  async disable(userId: Types.ObjectId, sessionId: Types.ObjectId, proof: IdentityProof): Promise<void> {
    const user = await this.confirmIdentity(userId, sessionId, proof, true);
    if (!user.mfa?.enabledAt) throw new AppError('CONFLICT', 'Two-step sign-in is not on');
    await UserModel.updateOne(
      { _id: userId },
      { $set: { 'mfa.totpSecret': null, 'mfa.enabledAt': null, 'mfa.lastUsedStep': null, 'mfa.recoveryCodes': [], 'mfa.pendingSecret': null, 'mfa.pendingCreatedAt': null } },
    );
    this.email.dispatch(mfaDisabledEmail(user.email, user.displayName));
  }

  async regenerateRecoveryCodes(userId: Types.ObjectId, sessionId: Types.ObjectId, proof: IdentityProof): Promise<string[]> {
    const user = await this.confirmIdentity(userId, sessionId, proof, true);
    if (!user.mfa?.enabledAt) throw new AppError('CONFLICT', 'Two-step sign-in is not on');
    const { codes, stored } = this.newRecoveryCodes();
    await UserModel.updateOne({ _id: userId }, { $set: { 'mfa.recoveryCodes': stored } });
    return codes;
  }

  // ------------------------------------------------------------------ the sign-in step

  async createChallenge(userId: Types.ObjectId, method: 'password' | 'google', remember = false): Promise<{ challenge: string; expiresAt: Date }> {
    const challenge = randomToken();
    const expiresAt = addMinutes(new Date(), CHALLENGE_MINUTES);
    await MfaChallengeModel.create({ userId, tokenHash: sha256(challenge), method, remember, expiresAt });
    return { challenge, expiresAt };
  }

  private expired(): AppError {
    return new AppError('CONFLICT', 'This sign-in has expired. Start again.');
  }

  /** The challenge's account, with its secrets, if the challenge is still open. */
  async openChallenge(raw: string): Promise<{ challengeId: Types.ObjectId; user: UserDoc; remember: boolean }> {
    const doc = await MfaChallengeModel.findOne({ tokenHash: sha256(raw), usedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: CHALLENGE_ATTEMPTS } });
    if (!doc) throw this.expired();
    const user = await UserModel.findOne({ _id: doc.userId, status: 'active' }).select(SECRETS);
    if (!user?.mfa?.enabledAt) throw this.expired();
    return { challengeId: doc._id, user, remember: doc.remember ?? false };
  }

  async failChallenge(challengeId: Types.ObjectId): Promise<void> {
    await MfaChallengeModel.updateOne({ _id: challengeId }, { $inc: { attempts: 1 } });
  }

  /** Marks the challenge used; false if another request used it first. */
  async closeChallenge(challengeId: Types.ObjectId): Promise<void> {
    const res = await MfaChallengeModel.updateOne({ _id: challengeId, usedAt: null }, { $set: { usedAt: new Date() } });
    if (res.modifiedCount !== 1) throw this.expired();
  }
}
