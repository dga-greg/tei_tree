import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { LucideMailWarning } from '@lucide/angular';
import { ApiError } from '../core/api/api-error';
import { AuthApi } from '../core/auth/auth.api';
import { AuthStore } from '../core/auth/auth.store';
import { TranslatePipe } from '../core/i18n/translate.pipe';

/** Reminds signed-in users with an unverified address; invitations and claims need a verified one. */
@Component({
  selector: 'fh-verify-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LucideMailWarning],
  template: `
    @if (auth.user(); as user) {
      @if (!user.emailVerified) {
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gold-300 bg-gold-100/70 px-4 py-2.5 text-sm text-gold-900 sm:px-6 dark:border-gold-700 dark:bg-stone-900 dark:text-gold-200" role="status">
          <svg lucideMailWarning class="size-4 shrink-0" aria-hidden="true"></svg>
          <p class="flex-1">
            {{ 'Please confirm' | t }} <strong>{{ user.email }}</strong> {{ 'using the link we sent you. Accepting invitations and claiming a profile need a verified address.' | t }}
          </p>
          @if (sent()) {
            <span class="font-medium">{{ 'A new link is on its way.' | t }}</span>
          } @else {
            <button type="button" class="font-semibold underline underline-offset-2 disabled:opacity-60" [disabled]="busy()" (click)="resend()">
              {{ 'Send the link again' | t }}
            </button>
          }
          @if (error(); as e) { <span class="w-full text-red-700 dark:text-red-300">{{ e }}</span> }
        </div>
      }
    }
  `,
})
export class VerifyBannerComponent {
  protected readonly auth = inject(AuthStore);
  private readonly authApi = inject(AuthApi);
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async resend(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.authApi.resendVerification();
      this.sent.set(true);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
