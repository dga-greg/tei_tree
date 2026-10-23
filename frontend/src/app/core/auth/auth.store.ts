import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { isMfaChallenge, type CurrentUser, type LoginRequest, type MfaChallengeResponse, type MfaVerifyRequest, type RegisterRequest } from '@fh/contracts';
import { currentLanguage, switchLanguage } from '../i18n/i18n';
import { languageOf } from '../i18n/languages';
import { AuthApi } from './auth.api';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

/** Written when this device signs out, so the app's other tabs follow. */
export const SIGNED_OUT_KEY = 'fh.signedOut';
/** Set while signed in on this device, so start-up can fetch the signed-in pages' code early (see main.ts). */
export const SIGNED_IN_KEY = 'fh.signedIn';

/** The signed-in user. The access/refresh tokens live in HttpOnly cookies and are never visible here. */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);

  private readonly _user = signal<CurrentUser | null>(null);
  private readonly _status = signal<AuthStatus>('unknown');

  readonly user = this._user.asReadonly();
  readonly status = this._status.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');
  readonly isSuperAdmin = computed(() => this._user()?.platformRole === 'super_admin');

  constructor() {
    // Signing out in one tab signs out the others.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === SIGNED_OUT_KEY && e.newValue && this._status() === 'authenticated') {
          this.setUser(null);
          void this.router.navigateByUrl('/auth/login');
        }
      });
    }
  }

  /** Lets the app's other tabs know this device signed out. */
  announceSignOut(): void {
    try {
      localStorage.setItem(SIGNED_OUT_KEY, String(Date.now()));
    } catch {
      /* storage unavailable: the other tabs find out on their next request */
    }
  }

  /**
   * Restores the session at start-up (the refresh interceptor renews an expired access token). Gives up after
   * a while so an unreachable server shows the sign-in page and its error instead of the loading screen forever.
   */
  async init(timeoutMs = 20_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)));
    try {
      this.setUser(await Promise.race([this.authApi.me(), timedOut]));
    } catch {
      this.setUser(null);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Signs in, or returns the challenge when the account asks for a two-step code. */
  async login(body: LoginRequest): Promise<MfaChallengeResponse | null> {
    const res = await this.authApi.login(body);
    if (isMfaChallenge(res)) return res;
    this.setUser(res.user);
    return null;
  }

  async verifyMfa(body: MfaVerifyRequest): Promise<void> {
    this.setUser(await this.authApi.verifyMfa(body));
  }

  async register(body: RegisterRequest): Promise<void> {
    this.setUser(await this.authApi.register(body));
  }

  async logout(): Promise<void> {
    try {
      await this.authApi.logout();
    } finally {
      this.announceSignOut();
      this.setUser(null);
      await this.router.navigateByUrl('/auth/login');
    }
  }

  setUser(user: CurrentUser | null): void {
    this._user.set(user);
    this._status.set(user ? 'authenticated' : 'anonymous');
    try {
      if (user) localStorage.setItem(SIGNED_IN_KEY, '1');
      else localStorage.removeItem(SIGNED_IN_KEY);
    } catch {
      /* storage unavailable: start-up just fetches the pages' code when it needs it */
    }
    if (user) this.followLanguage(user);
  }

  /**
   * The language follows the person from device to device. Accounts that never chose one say "en" (the default):
   * then the language picked on this device is saved to the account instead.
   */
  private followLanguage(user: CurrentUser): void {
    const saved = languageOf(user.preferences.locale)?.code ?? 'en';
    const here = currentLanguage().code;
    if (saved === here) return;
    if (saved === 'en') {
      void this.authApi.updateProfile({ preferences: { locale: here } }).then((u) => this._user.set(u)).catch(() => undefined);
    } else {
      switchLanguage(saved);
    }
  }

  /** Called when the session cannot be renewed (expired, revoked elsewhere, account suspended). */
  sessionEnded(): void {
    if (this._status() !== 'authenticated') return;
    this.setUser(null);
    const returnUrl = this.router.url;
    void this.router.navigate(['/auth/login'], { queryParams: { returnUrl, reason: 'expired' } });
  }
}
