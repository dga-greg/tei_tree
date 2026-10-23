import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthStore } from '../auth/auth.store';

/** Applies the user's theme preference (system / light / dark) to <html data-theme>. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthStore);
  private readonly systemDark = signal(false);

  /** Whether the dark theme is currently applied (charts re-render from this). */
  readonly isDark = computed(() => {
    const pref = this.auth.user()?.preferences.theme ?? 'system';
    return pref === 'dark' || (pref === 'system' && this.systemDark());
  });

  constructor() {
    const media = this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (media) {
      this.systemDark.set(media.matches);
      media.addEventListener('change', (e) => this.systemDark.set(e.matches));
    }
    effect(() => {
      this.document.documentElement.dataset['theme'] = this.isDark() ? 'dark' : 'light';
    });
  }
}
