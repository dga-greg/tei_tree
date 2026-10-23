import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { CalendarApi } from '../calendar/calendar.api';
import { t } from '../i18n/i18n';

/** The browser's install prompt (Chrome, Edge, Android). Not part of the standard DOM types yet. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Installing the web app on a phone or computer, and turning phone notifications on or off for this
 * device. Created at start-up so the browser's install prompt, which fires early, is not missed.
 */
@Injectable({ providedIn: 'root' })
export class AppInstallService {
  private readonly document = inject(DOCUMENT);
  private readonly swPush = inject(SwPush);
  private readonly api = inject(CalendarApi);
  private prompt: InstallPromptEvent | null = null;

  /** The browser offers installation (Chrome, Edge, Android). */
  readonly canInstall = signal(false);
  /** Already running as the installed app. */
  readonly installed = signal(false);
  /** iPhone and iPad install through Share → Add to Home Screen instead of a prompt. */
  readonly isIos: boolean;
  /** Notifications need the service worker, which runs in production builds. */
  readonly pushSupported: boolean;

  constructor() {
    const win = this.document.defaultView;
    this.isIos = !!win && /iphone|ipad|ipod/i.test(win.navigator.userAgent);
    this.pushSupported = this.swPush.isEnabled && !!win && 'Notification' in win;
    this.installed.set(!!win?.matchMedia?.('(display-mode: standalone)').matches || (win?.navigator as { standalone?: boolean } | undefined)?.standalone === true);
    win?.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.prompt = e as InstallPromptEvent;
      this.canInstall.set(true);
    });
    win?.addEventListener('appinstalled', () => {
      this.prompt = null;
      this.canInstall.set(false);
      this.installed.set(true);
    });
  }

  async install(): Promise<boolean> {
    if (!this.prompt) return false;
    await this.prompt.prompt();
    const { outcome } = await this.prompt.userChoice;
    this.prompt = null;
    this.canInstall.set(false);
    return outcome === 'accepted';
  }

  /** Whether this device is subscribed to notifications. */
  async subscribed(): Promise<boolean> {
    if (!this.pushSupported) return false;
    return !!(await firstValueFrom(this.swPush.subscription));
  }

  /** Asks permission and registers this device. Throws if the person declines. */
  async enablePush(publicKey: string): Promise<void> {
    // The browser registers with its push service (Google, Mozilla, Apple…); without a connection it never answers.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(t("The browser's notification service did not answer. Check the internet connection and try again."))), 20_000)));
    const sub = await Promise.race([this.swPush.requestSubscription({ serverPublicKey: publicKey }), timeout]).finally(() => clearTimeout(timer));
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await this.api.subscribe({ endpoint: json.endpoint, keys: json.keys });
  }

  async disablePush(): Promise<void> {
    const sub = await firstValueFrom(this.swPush.subscription);
    if (!sub) return;
    await this.api.unsubscribe(sub.endpoint);
    await sub.unsubscribe();
  }
}
