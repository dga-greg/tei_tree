import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { PublicConfigService } from '../../core/config/public-config.service';
import { mark, t } from '../../core/i18n/i18n';

/** "Continue with Google": a full-page trip to Google and back, so it is a link, not an API call. */
@Component({
  selector: 'fh-google-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enabled()) {
      <a [href]="href()" class="btn-secondary w-full gap-3">
        <svg viewBox="0 0 48 48" class="size-5" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
        {{ label() }}
      </a>
    }
  `,
})
export class GoogleButtonComponent {
  readonly mode = input<'login' | 'link'>('login');
  readonly next = input<string | null>(null);
  readonly label = input(t('Continue with Google'));
  /** "Keep me signed in on this device". */
  readonly remember = input(false);

  protected readonly enabled = signal(false);
  protected readonly href = computed(() => {
    const params = new URLSearchParams({ mode: this.mode() });
    if (this.next()) params.set('next', this.next()!);
    if (this.remember()) params.set('remember', '1');
    return `/api/v1/auth/google/start?${params.toString()}`;
  });

  constructor() {
    void inject(PublicConfigService).get().then((c) => this.enabled.set(c.google));
  }
}

/** What went wrong on the way back from Google (the `google` query parameter). */
export const GOOGLE_PROBLEMS: Record<string, string> = {
  cancelled: mark('Signing in with Google was cancelled.'),
  expired: mark('That Google sign-in took too long or came from another window. Please try again.'),
  failed: mark('Google sign-in did not work this time. Please try again, or sign in with your password.'),
  link_needed: mark(
    'An account with that Google address already exists. Sign in with your password, then link Google in Settings → Security.',
  ),
  unverified: mark('Google has not confirmed that e-mail address yet, so it cannot be used to create an account.'),
  suspended: mark('This account has been suspended. Contact the platform administrator.'),
  unavailable: mark('Google sign-in is not available on this server.'),
};
