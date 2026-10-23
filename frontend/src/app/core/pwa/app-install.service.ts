import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/** The browser's install prompt (Chrome, Edge, Android). Not part of the standard DOM types yet. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Installing the web app on a phone or computer. Created at start-up so the browser's install prompt, which fires early, is not missed.
 */
@Injectable({ providedIn: 'root' })
export class AppInstallService {
  private readonly document = inject(DOCUMENT);
  private prompt: InstallPromptEvent | null = null;

  /** The browser offers installation (Chrome, Edge, Android). */
  readonly canInstall = signal(false);
  /** Already running as the installed app. */
  readonly installed = signal(false);
  /** iPhone and iPad install through Share → Add to Home Screen instead of a prompt. */
  readonly isIos: boolean;

  constructor() {
    const win = this.document.defaultView;
    this.isIos = !!win && /iphone|ipad|ipod/i.test(win.navigator.userAgent);
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
}
