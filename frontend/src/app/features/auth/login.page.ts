import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { safeReturnUrl } from '../../core/auth/guards';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { PasswordRevealComponent } from '../../shared/ui/password-reveal.component';
import { GOOGLE_PROBLEMS, GoogleButtonComponent } from './google-button.component';
import { MfaStepComponent } from './mfa-step.component';

@Component({
  selector: 'fh-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, PasswordRevealComponent, ReactiveFormsModule, RouterLink, FormFieldComponent, AlertComponent, GoogleButtonComponent, MfaStepComponent],
  template: `
    @if (challenge(); as c) {
      <fh-mfa-step [challenge]="c" (done)="signedIn()" (cancel)="challenge.set(null)" />
    } @else {
    <h1 class="text-3xl font-semibold">{{ 'Welcome back' | t }}</h1>
    <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">{{ "Sign in to continue to your family's history." | t }}</p>

    @if (expired) {
      <fh-alert tone="info" class="mt-6">{{ 'Your session ended. Please sign in again.' | t }}</fh-alert>
    }
    @if (idle) {
      <fh-alert tone="info" class="mt-6">{{ 'You were signed out because the app was not used for a while. Sign in again to continue where you were.' | t }}</fh-alert>
    }
    @if (accountDeleted) {
      <fh-alert tone="success" class="mt-6">{{ 'Your account has been deleted.' | t }}</fh-alert>
    }
    @if (error(); as e) {
      <fh-alert class="mt-6">{{ e.message }}</fh-alert>
    }
    @if (googleProblem; as g) {
      <fh-alert [tone]="googleCode === 'cancelled' || googleCode === 'link_needed' ? 'info' : 'error'" class="mt-6">{{ g | t }}</fh-alert>
    }

    <div class="mt-8">
      <fh-google-button [next]="returnUrl" [remember]="remember()" />
    </div>

    <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 space-y-5" novalidate>
      <fh-form-field [label]="'E-mail address' | t" [control]="form.controls.email" #email>
        <input class="input" type="email" autocomplete="email" formControlName="email"
               [attr.id]="email.controlId" [attr.aria-describedby]="email.describedBy()" [attr.aria-invalid]="!!email.error()" />
      </fh-form-field>
      <fh-form-field [label]="'Password' | t" [control]="form.controls.password" #password>
        <fh-password-reveal><input class="input" type="password" autocomplete="current-password" formControlName="password"
               [attr.id]="password.controlId" [attr.aria-describedby]="password.describedBy()" [attr.aria-invalid]="!!password.error()" /></fh-password-reveal>
      </fh-form-field>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" class="mt-0.5 size-4 accent-brand-700" [checked]="remember()" (change)="remember.set($any($event.target).checked)" />
          <span>{{ 'Keep me signed in on this device' | t }}<span class="block text-xs text-stone-500">{{ 'Only on your own phone or computer.' | t }}</span></span>
        </label>
        <a routerLink="/auth/forgot-password" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'Forgot your password?' | t }}</a>
      </div>
      <button type="submit" class="btn-primary w-full" [disabled]="busy()">
        {{ busy() ? ('Signing in…' | t) : ('Sign in' | t) }}
      </button>
    </form>

    <p class="mt-8 text-center text-sm text-stone-600 dark:text-stone-400">
      {{ 'New here?' | t }} <a routerLink="/auth/register" [queryParams]="{ returnUrl: returnUrl }" class="font-semibold text-brand-700 hover:underline dark:text-brand-300">{{ 'Create an account' | t }}</a>
    </p>
    }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly expired = this.route.snapshot.queryParamMap.get('reason') === 'expired';
  protected readonly idle = this.route.snapshot.queryParamMap.get('reason') === 'idle';
  protected readonly remember = signal(false);
  protected readonly accountDeleted = this.route.snapshot.queryParamMap.get('reason') === 'deleted';
  protected readonly returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
  protected readonly googleCode = this.route.snapshot.queryParamMap.get('google') ?? '';
  protected readonly googleProblem = GOOGLE_PROBLEMS[this.googleCode] ?? null;
  protected readonly challenge = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const challenge = await this.auth.login({ ...this.form.getRawValue(), remember: this.remember() });
      if (challenge) {
        this.form.controls.password.reset();
        this.challenge.set(challenge.challenge);
      } else await this.signedIn();
    } catch (err) {
      this.error.set(ApiError.from(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async signedIn(): Promise<void> {
    await this.router.navigateByUrl(safeReturnUrl(this.returnUrl));
  }
}
