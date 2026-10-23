import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { safeReturnUrl } from '../../core/auth/guards';
import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { GoogleButtonComponent } from './google-button.component';
import { PasswordRevealComponent } from '../../shared/ui/password-reveal.component';

@Component({
  selector: 'fh-register-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, PasswordRevealComponent, ReactiveFormsModule, RouterLink, FormFieldComponent, AlertComponent, GoogleButtonComponent],
  template: `
    <h1 class="text-3xl font-semibold">{{ 'Create your account' | t }}</h1>
    <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
      {{ 'Your account is separate from any family tree. You can start a family or join one by invitation.' | t }}
    </p>

    @if (error(); as e) {
      @if (!e.details.length) {
        <fh-alert class="mt-6">{{ e.message }}</fh-alert>
      }
    }

    <div class="mt-8"><fh-google-button [next]="returnUrl" [label]="'Sign up with Google' | t" /></div>

    <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 space-y-5" novalidate>
      <fh-form-field [label]="'Your name' | t" [control]="form.controls.displayName" [serverError]="error()?.fieldError('displayName')" #name>
        <input class="input" autocomplete="name" formControlName="displayName"
               [attr.id]="name.controlId" [attr.aria-describedby]="name.describedBy()" [attr.aria-invalid]="!!name.error()" />
      </fh-form-field>
      <fh-form-field [label]="'E-mail address' | t" [control]="form.controls.email" [serverError]="error()?.fieldError('email')" #email>
        <input class="input" type="email" autocomplete="email" formControlName="email"
               [attr.id]="email.controlId" [attr.aria-describedby]="email.describedBy()" [attr.aria-invalid]="!!email.error()" />
      </fh-form-field>
      <fh-form-field [label]="'Password' | t" [control]="form.controls.password" [serverError]="error()?.fieldError('password')"
                     [hint]="'At least {count} characters. A short phrase is easier to remember.' | t: { count: minLength }" #password>
        <fh-password-reveal><input class="input" type="password" autocomplete="new-password" formControlName="password"
               [attr.id]="password.controlId" [attr.aria-describedby]="password.describedBy()" [attr.aria-invalid]="!!password.error()" /></fh-password-reveal>
      </fh-form-field>
      <button type="submit" class="btn-primary w-full" [disabled]="busy()">
        {{ busy() ? ('Creating account…' | t) : ('Create account' | t) }}
      </button>
    </form>

    <p class="mt-8 text-center text-sm text-stone-600 dark:text-stone-400">
      {{ 'Already have an account?' | t }} <a routerLink="/auth/login" [queryParams]="{ returnUrl }" class="font-semibold text-brand-700 hover:underline dark:text-brand-300">{{ 'Sign in' | t }}</a>
    </p>
  `,
})
export class RegisterPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
  protected readonly minLength = PASSWORD_MIN_LENGTH;

  protected readonly form = inject(NonNullableFormBuilder).group({
    displayName: ['', [Validators.required, Validators.maxLength(DISPLAY_NAME_MAX_LENGTH)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH), Validators.maxLength(PASSWORD_MAX_LENGTH)]],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.register(this.form.getRawValue());
      await this.router.navigateByUrl(safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')) || '/dashboard');
    } catch (err) {
      this.error.set(ApiError.from(err));
    } finally {
      this.busy.set(false);
    }
  }
}
