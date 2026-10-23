import { createHash, createHmac } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError } from '../../core/errors.js';
import { randomToken, safeEqual } from '../../core/crypto.js';
import type { Logger } from '../../core/logger.js';
import type { EmailDispatcher } from '../../infra/email-dispatcher.js';
import { UserModel, type UserDoc } from '../users/user.model.js';
import { googleLinkedEmail } from './auth.emails.js';
import type { AuthService, ClientMeta, SignInOutcome } from './auth.service.js';
import { GoogleSignInError, type GoogleIdentity, type GoogleProfile } from './google.js';
import { AuthSessionModel } from './session.model.js';

const FLOW_MINUTES = 10;

/** What the browser carries between leaving for Google and coming back, signed so it cannot be altered. */
interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  mode: 'login' | 'link';
  /** For linking: who started it, and from which session. */
  userId?: string;
  sessionId?: string;
  next: string;
  /** "Keep me signed in on this device". */
  remember?: boolean;
  exp: number;
}

export type GoogleOutcome = { kind: 'signed_in'; outcome: SignInOutcome; next: string } | { kind: 'redirect'; path: string };

/** Only paths inside the app: "/members/1" yes, "//evil.example" or "https://…" no. */
export function safeNext(next: unknown, fallback = '/dashboard'): string {
  return typeof next === 'string' && next.length <= 500 && /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : fallback;
}

/** Google vouches for Gmail addresses, and for addresses of Workspace domains it manages (`hd`). */
function googleOwnsAddress(p: GoogleProfile): boolean {
  return p.emailVerified && (/@(gmail|googlemail)\.com$/.test(p.email) || (!!p.hostedDomain && p.email.endsWith(`@${p.hostedDomain.toLowerCase()}`)));
}

/**
 * Sign in with Google. A Google account signs in to the account it is linked to; the first time, it is linked
 * automatically only to an account whose address we confirmed and Google vouches for — otherwise the person
 * signs in with their password and links Google in Settings. A Google account with a new address gets a new
 * account. Two-step sign-in still applies after Google.
 */
export class GoogleSignInService {
  constructor(
    private readonly google: GoogleIdentity,
    private readonly auth: AuthService,
    private readonly email: EmailDispatcher,
    private readonly settings: { appOrigin: string; stateSecret: string },
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return this.google.enabled;
  }

  private get redirectUri(): string {
    return new URL('/api/v1/auth/google/callback', this.settings.appOrigin).toString();
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.settings.stateSecret).update(payload).digest('base64url');
  }

  private seal(flow: FlowState): string {
    const payload = Buffer.from(JSON.stringify(flow)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  private unseal(cookie: string | undefined): FlowState | null {
    const [payload, sig] = (cookie ?? '').split('.');
    if (!payload || !sig || !safeEqual(sig, this.sign(payload))) return null;
    try {
      const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as FlowState;
      return flow.exp > Date.now() ? flow : null;
    } catch {
      return null;
    }
  }

  /** Where to send the browser, and the cookie to carry along. Linking needs a signed-in session. */
  start(mode: 'login' | 'link', next: unknown, signedIn?: { userId: Types.ObjectId; sessionId: Types.ObjectId }, remember = false): { url: string; cookie: string; maxAgeMs: number } {
    if (!this.google.enabled) throw AppError.notFound('Google sign-in');
    if (mode === 'link' && !signedIn) throw AppError.unauthenticated();
    const verifier = randomToken(48);
    const flow: FlowState = {
      state: randomToken(),
      nonce: randomToken(),
      verifier,
      mode,
      ...(mode === 'link' ? { userId: signedIn!.userId.toString(), sessionId: signedIn!.sessionId.toString() } : {}),
      next: safeNext(next, mode === 'link' ? '/settings' : '/dashboard'),
      remember,
      exp: Date.now() + FLOW_MINUTES * 60_000,
    };
    const url = this.google.authorizeUrl({ state: flow.state, nonce: flow.nonce, codeChallenge: createHash('sha256').update(verifier).digest('base64url'), redirectUri: this.redirectUri });
    return { url, cookie: this.seal(flow), maxAgeMs: FLOW_MINUTES * 60_000 };
  }

  async callback(query: Record<string, unknown>, cookie: string | undefined, meta: ClientMeta): Promise<GoogleOutcome> {
    const flow = this.unseal(cookie);
    const back = (mode: FlowState['mode'] | undefined, problem: string) => ({ kind: 'redirect' as const, path: `${mode === 'link' ? '/settings' : '/auth/login'}?google=${problem}` });
    if (!flow || typeof query['state'] !== 'string' || !safeEqual(query['state'], flow.state)) return back(flow?.mode, 'expired');
    if (typeof query['error'] === 'string') return back(flow.mode, 'cancelled');
    if (typeof query['code'] !== 'string') return back(flow.mode, 'failed');

    let profile: GoogleProfile;
    try {
      profile = await this.google.exchange(query['code'], flow.verifier, this.redirectUri, flow.nonce);
    } catch (err) {
      this.logger.warn({ err: err instanceof GoogleSignInError ? err.message : err }, 'Google sign-in failed');
      return back(flow.mode, 'failed');
    }
    return flow.mode === 'link' ? this.link(flow, profile) : this.login(flow, profile, meta);
  }

  private async link(flow: FlowState, profile: GoogleProfile): Promise<GoogleOutcome> {
    // The session that asked must still be signed in.
    const session = await AuthSessionModel.exists({ _id: flow.sessionId, userId: flow.userId, revokedAt: null, expiresAt: { $gt: new Date() } });
    const user = session ? await UserModel.findOne({ _id: flow.userId, status: 'active' }) : null;
    if (!user) return { kind: 'redirect', path: '/auth/login?google=expired' };
    const holder = await UserModel.findOne({ 'google.sub': profile.sub }, { _id: 1 });
    if (holder && !holder._id.equals(user._id)) return { kind: 'redirect', path: '/settings?google=in_use' };
    await this.attach(user, profile);
    return { kind: 'redirect', path: `${flow.next}${flow.next.includes('?') ? '&' : '?'}google=linked` };
  }

  private async attach(user: UserDoc, profile: GoogleProfile): Promise<void> {
    await UserModel.updateOne({ _id: user._id }, { $set: { 'google.sub': profile.sub, 'google.email': profile.email, 'google.linkedAt': new Date() } });
    this.email.dispatch(googleLinkedEmail(user.email, user.displayName, profile.email));
    this.logger.info({ userId: user.id }, 'Google account linked');
  }

  private async login(flow: FlowState, profile: GoogleProfile, meta: ClientMeta): Promise<GoogleOutcome> {
    let user = await UserModel.findOne({ 'google.sub': profile.sub });
    if (!user) {
      const existing = await UserModel.findOne({ email: profile.email });
      if (existing) {
        if (existing.status !== 'active') return { kind: 'redirect', path: '/auth/login?google=suspended' };
        // Linking by address needs both sides to vouch for it; otherwise the owner links it from Settings.
        if (existing.google?.sub || !existing.emailVerifiedAt || !googleOwnsAddress(profile)) return { kind: 'redirect', path: '/auth/login?google=link_needed' };
        await this.attach(existing, profile);
        user = (await UserModel.findById(existing._id))!;
      } else {
        if (!profile.emailVerified) return { kind: 'redirect', path: '/auth/login?google=unverified' };
        user = await UserModel.create({
          email: profile.email,
          passwordHash: null,
          displayName: (profile.name || profile.email.split('@')[0]!).slice(0, 80),
          emailVerifiedAt: new Date(),
          google: { sub: profile.sub, email: profile.email, linkedAt: new Date() },
        });
        this.logger.info({ userId: user.id }, 'Account created with Google');
      }
    }
    if (user.status !== 'active') return { kind: 'redirect', path: '/auth/login?google=suspended' };
    return { kind: 'signed_in', outcome: await this.auth.completeSignIn(user, meta, 'google', flow.remember === true), next: flow.next };
  }

  /** Removes the Google account; only when the account has a password to sign in with instead. */
  async unlink(userId: Types.ObjectId): Promise<void> {
    const user = await UserModel.findById(userId).select('+passwordHash');
    if (!user?.google?.sub) throw new AppError('CONFLICT', 'No Google account is linked');
    if (!user.passwordHash) throw new AppError('CONFLICT', 'Set a password first, so you can still sign in without Google.');
    await UserModel.updateOne({ _id: userId }, { $set: { 'google.sub': null, 'google.email': null, 'google.linkedAt': null } });
  }
}
