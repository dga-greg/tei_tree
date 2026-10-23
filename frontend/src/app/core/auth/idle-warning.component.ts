import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '../i18n/translate.pipe';
import { AuthStore } from './auth.store';
import { IdleTimeoutService } from './idle-timeout.service';

/** Shown a minute before the idle sign-out. */
@Component({
  selector: 'fh-idle-warning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block card w-[min(26rem,calc(100vw-2rem))] p-6 shadow-(--shadow-raised)' },
  template: `
    <h2 id="idle-title" class="text-xl font-semibold">{{ 'Are you still there?' | t }}</h2>
    <p class="mt-3 text-sm text-stone-600 dark:text-stone-300" aria-live="polite">
      {{ '{count, plural, one {You will be signed out in # second because the app has not been used for a while.} other {You will be signed out in # seconds because the app has not been used for a while.}}' | t: { count: idle.secondsLeft() } }}
    </p>
    <div class="mt-6 flex flex-wrap justify-end gap-2">
      <button type="button" class="btn-secondary" (click)="auth.logout()">{{ 'Sign out now' | t }}</button>
      <button type="button" class="btn-primary" (click)="idle.stay()" cdkFocusInitial>{{ 'Stay signed in' | t }}</button>
    </div>
  `,
})
export class IdleWarningComponent {
  protected readonly idle = inject(IdleTimeoutService);
  protected readonly auth = inject(AuthStore);
}
