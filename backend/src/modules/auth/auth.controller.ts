import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import type { AuthResponse, CsrfResponse, CurrentUser, LoginResponse, MfaStatus, RecoveryCodesResponse, TotpSetupResponse } from '@fh/contracts';
import { parse, parseIdParam } from '../../core/validation.js';
import { authOf } from '../../middleware/authenticate.js';
import type { CsrfProtection } from '../../middleware/csrf.js';
import { toCurrentUser } from '../users/user.mapper.js';
import { UserModel, type UserDoc } from '../users/user.model.js';
import type { AuthResult, AuthService, ClientMeta, SignInOutcome } from './auth.service.js';
import { GOOGLE_COOKIE, REFRESH_COOKIE, type AuthCookies } from './cookies.js';
import type { GoogleSignInService } from './google.service.js';
import type { MfaService } from './mfa.service.js';
import {
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  mfaConfirmBody,
  mfaEnableBody,
  mfaVerifyBody,
  registerBody,
  resetPasswordBody,
  updateProfileBody,
  verifyEmailBody,
} from './auth.validators.js';

function clientMeta(req: Request): ClientMeta {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
    private readonly csrf: CsrfProtection,
    private readonly mfa: MfaService,
    private readonly google: GoogleSignInService,
    private readonly appOrigin: string,
  ) {}

  /** `sessionId`: the device's session, for its idle limit. */
  private async view(user: UserDoc, sessionId?: Types.ObjectId): Promise<CurrentUser> {
    const [hasPassword, idleTimeoutMinutes] = await Promise.all([UserModel.exists({ _id: user._id, passwordHash: { $type: 'string' } }).then(Boolean), this.auth.idleLimit(sessionId)]);
    return toCurrentUser(user, { hasPassword, mfaRequired: this.mfa.required(user) }, { idleTimeoutMinutes });
  }

  private startSession(res: Response, result: AuthResult): void {
    const { tokens } = result;
    this.cookies.setAccess(res, tokens.accessToken, tokens.accessExpiresAt);
    if (tokens.refresh) this.cookies.setRefresh(res, tokens.refresh.token, tokens.refresh.expiresAt);
    // A fresh CSRF token per session limits the lifetime of any leaked token.
    this.csrf.issue(res);
  }

  private async respondWithSession(res: Response, result: AuthResult, status = 200): Promise<void> {
    this.startSession(res, result);
    const body: { data: AuthResponse } = { data: { user: await this.view(result.user, result.tokens.sessionId) } };
    res.status(status).json(body);
  }

  private async respondWithOutcome(res: Response, outcome: SignInOutcome): Promise<void> {
    if (outcome.kind === 'session') return this.respondWithSession(res, outcome);
    const body: { data: LoginResponse } = { data: { mfaRequired: true, challenge: outcome.challenge, expiresAt: outcome.expiresAt.toISOString() } };
    res.json(body);
  }

  private toApp(res: Response, path: string): void {
    res.redirect(302, new URL(path, this.appOrigin).toString());
  }

  csrfToken = (_req: Request, res: Response) => {
    const body: { data: CsrfResponse } = { data: { token: this.csrf.tokenFor(res) } };
    res.json(body);
  };

  register = async (req: Request, res: Response) => {
    const input = parse(registerBody, req.body);
    await this.respondWithSession(res, await this.auth.register(input, clientMeta(req)), 201);
  };

  login = async (req: Request, res: Response) => {
    const input = parse(loginBody, req.body);
    await this.respondWithOutcome(res, await this.auth.login(input, clientMeta(req)));
  };

  verifyMfa = async (req: Request, res: Response) => {
    const { challenge, ...proof } = parse(mfaVerifyBody, req.body);
    await this.respondWithSession(res, await this.auth.verifyMfa(challenge, proof, clientMeta(req)));
  };

  mfaStatus = async (req: Request, res: Response) => {
    const body: { data: MfaStatus } = { data: await this.mfa.status(authOf(req).userId) };
    res.json(body);
  };

  mfaSetup = async (req: Request, res: Response) => {
    const auth = authOf(req);
    const body: { data: TotpSetupResponse } = { data: await this.mfa.setup(auth.userId, auth.sessionId, parse(mfaConfirmBody, req.body)) };
    res.json(body);
  };

  /** Turning two-step sign-in on signs out every other device: any of them could be the reason for it. */
  mfaEnable = async (req: Request, res: Response) => {
    const auth = authOf(req);
    const codes = await this.mfa.enable(auth.userId, parse(mfaEnableBody, req.body).code);
    await this.auth.revokeAllSessions(auth.userId, 'mfa_enabled', auth.sessionId);
    const body: { data: RecoveryCodesResponse } = { data: { codes } };
    res.json(body);
  };

  mfaDisable = async (req: Request, res: Response) => {
    const auth = authOf(req);
    await this.mfa.disable(auth.userId, auth.sessionId, parse(mfaConfirmBody, req.body));
    res.status(204).end();
  };

  recoveryCodes = async (req: Request, res: Response) => {
    const auth = authOf(req);
    const body: { data: RecoveryCodesResponse } = { data: { codes: await this.mfa.regenerateRecoveryCodes(auth.userId, auth.sessionId, parse(mfaConfirmBody, req.body)) } };
    res.json(body);
  };

  /** Leaves for Google. A navigation, not an API call: problems come back as a page in the app. */
  googleStart = (req: Request, res: Response) => {
    const mode = req.query['mode'] === 'link' ? 'link' : 'login';
    if (!this.google.enabled) return this.toApp(res, '/auth/login?google=unavailable');
    if (mode === 'link' && !req.auth) return this.toApp(res, '/auth/login?returnUrl=%2Fsettings');
    const flow = this.google.start(mode, req.query['next'], req.auth ? { userId: req.auth.userId, sessionId: req.auth.sessionId } : undefined, req.query['remember'] === '1');
    this.cookies.setGoogleFlow(res, flow.cookie, flow.maxAgeMs);
    res.redirect(302, flow.url);
  };

  googleCallback = async (req: Request, res: Response) => {
    const cookie: unknown = req.cookies?.[GOOGLE_COOKIE];
    const result = await this.google.callback(req.query, typeof cookie === 'string' ? cookie : undefined, clientMeta(req));
    this.cookies.clearGoogleFlow(res);
    if (result.kind === 'redirect') return this.toApp(res, result.path);
    if (result.outcome.kind === 'session') {
      this.startSession(res, result.outcome);
      return this.toApp(res, result.next);
    }
    // The challenge travels in the fragment, which browsers never send to servers or put in logs.
    this.toApp(res, `/auth/two-step#${new URLSearchParams({ challenge: result.outcome.challenge, next: result.next }).toString()}`);
  };

  googleUnlink = async (req: Request, res: Response) => {
    await this.google.unlink(authOf(req).userId);
    res.status(204).end();
  };

  refresh = async (req: Request, res: Response) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    try {
      await this.respondWithSession(res, await this.auth.refresh(typeof token === 'string' ? token : undefined, clientMeta(req)));
    } catch (err) {
      this.cookies.clear(res);
      throw err;
    }
  };

  logout = async (req: Request, res: Response) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    await this.auth.logout(req.auth?.sessionId, typeof token === 'string' ? token : undefined);
    this.cookies.clear(res);
    res.status(204).end();
  };

  forgotPassword = async (req: Request, res: Response) => {
    const { email } = parse(forgotPasswordBody, req.body);
    await this.auth.forgotPassword(email, clientMeta(req));
    res.status(202).json({ data: { message: 'If an account exists for that address, a reset link has been sent.' } });
  };

  resetPassword = async (req: Request, res: Response) => {
    const { token, password } = parse(resetPasswordBody, req.body);
    await this.auth.resetPassword(token, password);
    this.cookies.clear(res);
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    const auth = authOf(req);
    const body: { data: AuthResponse } = { data: { user: await this.view(auth.user, auth.sessionId) } };
    res.json(body);
  };

  /** The app reports activity (at most every few minutes) so the idle sign-out does not apply. */
  activity = async (req: Request, res: Response) => {
    await this.auth.recordActivity(authOf(req).sessionId);
    res.status(204).end();
  };

  updateMe = async (req: Request, res: Response) => {
    const patch = parse(updateProfileBody, req.body);
    const auth = authOf(req);
    const user = await this.auth.updateProfile(auth.userId, patch);
    res.json({ data: { user: await this.view(user, auth.sessionId) } });
  };

  changePassword = async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = parse(changePasswordBody, req.body);
    const auth = authOf(req);
    await this.auth.changePassword(auth.userId, auth.sessionId, currentPassword, newPassword);
    res.status(204).end();
  };

  sessions = async (req: Request, res: Response) => {
    const auth = authOf(req);
    res.json({ data: await this.auth.listSessions(auth.userId, auth.sessionId) });
  };

  revokeSession = async (req: Request, res: Response) => {
    const auth = authOf(req);
    await this.auth.revokeSession(auth.userId, parseIdParam(req.params['sessionId'], 'Session'));
    res.status(204).end();
  };

  verifyEmail = async (req: Request, res: Response) => {
    const { token } = parse(verifyEmailBody, req.body);
    const user = await this.auth.verifyEmail(token);
    res.json({ data: { user: await this.view(user, req.auth?.sessionId) } });
  };

  resendVerification = async (req: Request, res: Response) => {
    await this.auth.resendVerification(authOf(req).userId);
    res.status(202).json({ data: { message: 'A new confirmation link has been sent.' } });
  };
}
