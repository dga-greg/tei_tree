import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';

@Component({
  selector: 'fh-forgot-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ReactiveFormsModule, RouterLink, FormFieldComponent, AlertComponent],
  template: `
    <h1 class="text-3xl font-semibold">{{ 'Reset your password' | t }}</h1>
    @if (sent()) {
      <fh-alert tone="success" class="mt-6">
        {{ 'If an account exists for' | t }} <strong>{{ form.controls.email.value }}</strong>{{ ', we have sent a link to reset the password. The link expires soon, so use it promptly.' | t }}
      </fh-alert>
    } @else {
      <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">{{ 'Enter your e-mail address and we will send you a reset link.' | t }}</p>
      @if (error(); as e) {
        <fh-alert class="mt-6">{{ e.message }}</fh-alert>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-8 space-y-5" novalidate>
        <fh-form-field [label]="'E-mail address' | t" [control]="form.controls.email" #email>
          <input class="input" type="email" autocomplete="email" formControlName="email"
                 [attr.id]="email.controlId" [attr.aria-describedby]="email.describedBy()" [attr.aria-invalid]="!!email.error()" />
        </fh-form-field>
        <button type="submit" class="btn-primary w-full" [disabled]="busy()">{{ busy() ? ('Sending…' | t) : ('Send reset link' | t) }}</button>
      </form>
    }
    <p class="mt-8 text-center text-sm">
      <a routerLink="/auth/login" class="font-semibold text-brand-700 hover:underline dark:text-brand-300">{{ 'Back to sign in' | t }}</a>
    </p>
  `,
})
export class ForgotPasswordPage {
  private readonly authApi = inject(AuthApi);
  protected readonly form = inject(NonNullableFormBuilder).group({ email: ['', [Validators.required, Validators.email]] });
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.authApi.forgotPassword(this.form.controls.email.value);
      this.sent.set(true);
    } catch (err) {
      this.error.set(ApiError.from(err));
    } finally {
      this.busy.set(false);
    }
  }
}
