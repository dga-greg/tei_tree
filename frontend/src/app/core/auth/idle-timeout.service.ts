import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AuthApi } from './auth.api';
import { AuthStore } from './auth.store';
import { IdleWarningComponent } from './idle-warning.component';

/** Shared by the app's tabs, so using any of them keeps all of them signed in. */
const LAST_ACTIVITY = 'fh.lastActivity';
const LAST_REPORT = 'fh.lastActivityReport';
/** The warning shows this long before signing out. */
const WARNING_MS = 60_000;
/** How often, at most, activity is reported to the server (well inside its idle limit). */
const REPORT_EVERY_MS = 4 * 60_000;
const EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/**
 * Signs out after a period without mouse, keyboard, touch or scrolling, with a minute's warning first, unless the
 * person chose "Keep me signed in on this device" (the session then has no idle limit). The server applies the
 * same limit, so a closed or sleeping device is signed out too.
 */
@Injectable({ providedIn: 'root' })
export class IdleTimeoutService {
  private readonly auth = inject(AuthStore);
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly dialog = inject(Dialog);

  /** Seconds left while the warning shows. */
  readonly secondsLeft = signal(0);
  private limitMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private warning: DialogRef<unknown, IdleWarningComponent> | null = null;
  private lastWrite = 0;
  private readonly onActivity = () => {
    // While the warning shows, only its buttons count: a passing cat on the keyboard should not.
    if (!this.warning) this.markActive();
  };

  constructor() {
    effect(() => {
      const minutes = this.auth.user()?.session?.idleTimeoutMinutes ?? null;
      untracked(() => (minutes ? this.start(minutes) : this.stop()));
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private start(minutes: number): void {
    this.stop();
    this.limitMs = minutes * 60_000;
    this.markActive(true);
    for (const e of EVENTS) window.addEventListener(e, this.onActivity, { passive: true, capture: true });
    this.timer = setInterval(() => this.check(), 1000);
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const e of EVENTS) window.removeEventListener(e, this.onActivity, { capture: true });
    this.closeWarning();
  }

  /** Records activity (shared with other tabs) and reports it to the server now and then. */
  markActive(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastWrite < 5000) return;
    this.lastWrite = now;
    write(LAST_ACTIVITY, now);
    if (force || now - read(LAST_REPORT, 0) > REPORT_EVERY_MS) {
      write(LAST_REPORT, now);
      // A failure here is handled like any other request: an ended session leads to the sign-in page.
      this.authApi.reportActivity().catch(() => undefined);
    }
  }

  private check(): void {
    const idle = Date.now() - read(LAST_ACTIVITY, this.lastWrite);
    if (idle >= this.limitMs) {
      void this.signOut();
    } else if (idle >= this.limitMs - WARNING_MS) {
      this.secondsLeft.set(Math.ceil((this.limitMs - idle) / 1000));
      if (!this.warning) {
        this.warning = this.dialog.open(IdleWarningComponent, { disableClose: true, role: 'alertdialog', ariaLabelledBy: 'idle-title' });
        this.warning.closed.subscribe(() => (this.warning = null));
      }
    } else {
      // Someone used the app in another tab.
      this.closeWarning();
    }
  }

  /** "Stay signed in". */
  stay(): void {
    this.closeWarning();
    this.lastWrite = 0;
    write(LAST_REPORT, 0);
    this.markActive(true);
  }

  private closeWarning(): void {
    this.warning?.close();
    this.warning = null;
  }

  private async signOut(): Promise<void> {
    const returnUrl = this.router.url;
    this.stop();
    await this.authApi.logout().catch(() => undefined);
    this.auth.announceSignOut();
    this.auth.setUser(null);
    await this.router.navigate(['/auth/login'], { queryParams: { reason: 'idle', returnUrl } });
  }
}

function read(key: string, fallback: number): number {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private browsing without storage: this tab still keeps its own time */
  }
}
