import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideShieldCheck } from '@lucide/angular';
import { ApiError } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';

/** The second sign-in step: a code from the authenticator app, or a recovery code. Emits once signed in. */
@Component({
  selector: 'fh-mfa-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, FormsModule, AlertComponent, LucideShieldCheck],
  template: `
    <div class="flex items-center gap-3">
      <span class="grid size-11 place-items-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"><svg lucideShieldCheck class="size-6" aria-hidden="true"></svg></span>
      <div>
        <h1 class="text-2xl font-semibold">{{ 'Two-step sign-in' | t }}</h1>
        <p class="text-sm text-stone-600 dark:text-stone-400">
          {{ recovery() ? ('Type one of the recovery codes you saved.' | t) : ('Open your authenticator app and type the 6-digit code for Family Heritage.' | t) }}
        </p>
      </div>
    </div>
    @if (error(); as e) { <fh-alert class="mt-6">{{ e }}</fh-alert> }
    <form class="mt-6 space-y-5" (ngSubmit)="submit()">
      @if (recovery()) {
        <div>
          <label class="label" for="mfa-recovery">{{ 'Recovery code' | t }}</label>
          <input #field id="mfa-recovery" name="recovery" class="input font-mono tracking-wider" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx" maxlength="32" [(ngModel)]="value" required /> <!-- i18n-ignore -->
        </div>
      } @else {
        <div>
          <label class="label" for="mfa-code">{{ 'Code' | t }}</label>
          <input #field id="mfa-code" name="code" class="input text-center font-mono text-2xl tracking-[0.4em]" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" placeholder="123456" [(ngModel)]="value" required />
        </div>
      }
      <button type="submit" class="btn-primary w-full" [disabled]="busy()">{{ busy() ? ('Checking…' | t) : ('Continue' | t) }}</button>
    </form>
    <div class="mt-6 flex flex-wrap justify-between gap-2 text-sm">
      <button type="button" class="font-medium text-brand-700 hover:underline dark:text-brand-300" (click)="toggle()">
        {{ recovery() ? ('Use the authenticator app' | t) : ('Lost your phone? Use a recovery code' | t) }}
      </button>
      <button type="button" class="text-stone-500 hover:underline" (click)="cancel.emit()">{{ 'Start again' | t }}</button>
    </div>
  `,
})
export class MfaStepComponent {
  readonly challenge = input.required<string>();
  readonly done = output<void>();
  readonly cancel = output<void>();

  private readonly auth = inject(AuthStore);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  protected readonly recovery = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected value = '';

  constructor() {
    afterNextRender(() => this.field()?.nativeElement.focus());
  }

  protected toggle(): void {
    this.recovery.update((r) => !r);
    this.value = '';
    this.error.set(null);
    setTimeout(() => this.field()?.nativeElement.focus());
  }

  protected async submit(): Promise<void> {
    const value = this.value.trim();
    if (!value) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.verifyMfa(this.recovery() ? { challenge: this.challenge(), recoveryCode: value } : { challenge: this.challenge(), code: value.replace(/\s/g, '') });
      this.done.emit();
    } catch (err) {
      const e = ApiError.from(err);
      this.error.set(e.code === 'CONFLICT' ? t('This sign-in has expired or had too many wrong codes. Start again.') : e.message);
      this.value = '';
    } finally {
      this.busy.set(false);
    }
  }
}
