import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { safeReturnUrl } from '../../core/auth/guards';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MfaStepComponent } from './mfa-step.component';

/**
 * The code step after signing in with Google. The challenge arrives in the URL fragment (never sent to a
 * server) and is removed from the address bar straight away.
 */
@Component({
  selector: 'fh-two-step-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink, MfaStepComponent],
  template: `
    @if (challenge) {
      <fh-mfa-step [challenge]="challenge" (done)="signedIn()" (cancel)="restart()" />
    } @else {
      <h1 class="text-2xl font-semibold">{{ 'This sign-in link has expired' | t }}</h1>
      <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">{{ 'Please sign in again.' | t }}</p>
      <a routerLink="/auth/login" class="btn-primary mt-6">{{ 'Sign in' | t }}</a>
    }
  `,
})
export class TwoStepPage {
  private readonly router = inject(Router);
  private readonly params = new URLSearchParams(typeof location !== 'undefined' ? location.hash.slice(1) : '');
  protected readonly challenge = this.params.get('challenge');
  private readonly next = this.params.get('next');

  constructor() {
    if (typeof history !== 'undefined') history.replaceState(history.state, '', location.pathname);
  }

  protected async signedIn(): Promise<void> {
    await this.router.navigateByUrl(safeReturnUrl(this.next));
  }

  protected async restart(): Promise<void> {
    await this.router.navigateByUrl('/auth/login');
  }
}
