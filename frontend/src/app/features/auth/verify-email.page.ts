import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { AuthStore } from '../../core/auth/auth.store';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

@Component({
  selector: 'fh-verify-email-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink, AlertComponent, SpinnerComponent],
  template: `
    <h1 class="text-3xl font-semibold">{{ 'Confirm your e-mail' | t }}</h1>
    @if (state() === 'working') {
      <div class="mt-6"><fh-spinner [showLabel]="true" [label]="'Confirming…' | t" /></div>
    } @else if (state() === 'done') {
      <fh-alert tone="success" class="mt-6">{{ 'Thank you — your e-mail address is confirmed. You can now accept invitations and claim your profile.' | t }}</fh-alert>
      <a [routerLink]="auth.isAuthenticated() ? '/dashboard' : '/auth/login'" class="btn-primary mt-6">{{ 'Continue' | t }}</a>
    } @else {
      <fh-alert class="mt-6">{{ error() }}</fh-alert>
      <a routerLink="/settings" class="btn-secondary mt-6">{{ 'Request a new link' | t }}</a>
    }
  `,
})
export class VerifyEmailPage {
  protected readonly auth = inject(AuthStore);
  private readonly authApi = inject(AuthApi);
  protected readonly state = signal<'working' | 'done' | 'failed'>('working');
  protected readonly error = signal('');

  constructor() {
    const token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('failed');
      this.error.set(t('This link is incomplete.'));
      return;
    }
    this.authApi
      .verifyEmail(token)
      .then((user) => {
        if (this.auth.isAuthenticated()) this.auth.setUser(user);
        this.state.set('done');
      })
      .catch((err: unknown) => {
        this.state.set('failed');
        this.error.set(ApiError.from(err).message);
      });
  }
}
