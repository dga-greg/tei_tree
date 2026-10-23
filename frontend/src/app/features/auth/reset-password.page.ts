import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { PasswordRevealComponent } from '../../shared/ui/password-reveal.component';

@Component({
  selector: 'fh-reset-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, PasswordRevealComponent, ReactiveFormsModule, RouterLink, FormFieldComponent, AlertComponent],
  template: `
    <h1 class="text-3xl font-semibold">{{ 'Choose a new password' | t }}</h1>
    @if (!token) {
      <fh-alert class="mt-6">{{ 'This reset link is incomplete. Request a new one from the sign-in page.' | t }}</fh-alert>
    } @else if (done()) {
      <fh-alert tone="success" class="mt-6">
        {{ 'Your password has been changed and every device has been signed out. You can now sign in with your new password.' | t }}
      </fh-alert>
    } @else {
      @if (error(); as e) {
        <fh-alert class="mt-6">{{ e.message }}</fh-alert>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-8 space-y-5" novalidate>
        <fh-form-field [label]="'New password' | t" [control]="form.controls.password" [hint]="'At least {count} characters.' | t: { count: minLength }" #password>
          <fh-password-reveal><input class="input" type="password" autocomplete="new-password" formControlName="password"
                 [attr.id]="password.controlId" [attr.aria-describedby]="password.describedBy()" [attr.aria-invalid]="!!password.error()" /></fh-password-reveal>
        </fh-form-field>
        <button type="submit" class="btn-primary w-full" [disabled]="busy()">{{ busy() ? ('Saving…' | t) : ('Set new password' | t) }}</button>
      </form>
    }
    <p class="mt-8 text-center text-sm">
      <a routerLink="/auth/login" class="font-semibold text-brand-700 hover:underline dark:text-brand-300">{{ 'Go to sign in' | t }}</a>
    </p>
  `,
})
export class ResetPasswordPage {
  private readonly authApi = inject(AuthApi);
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
  protected readonly minLength = PASSWORD_MIN_LENGTH;
  protected readonly form = inject(NonNullableFormBuilder).group({
    password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH), Validators.maxLength(PASSWORD_MAX_LENGTH)]],
  });
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid || !this.token) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.authApi.resetPassword({ token: this.token, password: this.form.controls.password.value });
      this.done.set(true);
    } catch (err) {
      this.error.set(ApiError.from(err));
    } finally {
      this.busy.set(false);
    }
  }
}
