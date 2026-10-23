import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideCopy, LucideDownload, LucideShieldCheck, LucideShieldAlert } from '@lucide/angular';
import type { MfaConfirmRequest, MfaStatus, TotpSetupResponse } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { AuthStore } from '../../core/auth/auth.store';
import { PublicConfigService } from '../../core/config/public-config.service';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { PasswordRevealComponent } from '../../shared/ui/password-reveal.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { GoogleButtonComponent } from '../auth/google-button.component';

type Step = 'idle' | 'confirm-on' | 'scan' | 'codes' | 'confirm-off' | 'confirm-codes';
type Message = { tone: 'success' | 'error' | 'info'; text: string };

const GOOGLE_RESULTS: Record<string, Message> = {
  linked: { tone: 'success', text: mark('Your Google account is linked. You can now sign in with Google.') },
  in_use: { tone: 'error', text: mark('That Google account is already linked to another Family Heritage account.') },
  cancelled: { tone: 'info', text: mark('Linking a Google account was cancelled.') },
  expired: { tone: 'error', text: mark('That took too long. Please try linking again.') },
  failed: { tone: 'error', text: mark('Google did not complete the link. Please try again.') },
};

/** Two-step sign-in (authenticator app + recovery codes) and the linked Google account. */
@Component({
  selector: 'fh-security-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, FormsModule, DatePipe, AlertComponent, SpinnerComponent, PasswordRevealComponent, GoogleButtonComponent, LucideShieldCheck, LucideShieldAlert, LucideCopy, LucideDownload],
  template: `
    @let me = auth.user()!;
    <section class="card p-6" aria-labelledby="mfa-heading">
      <h2 id="mfa-heading" class="flex items-center gap-2 text-lg font-semibold">
        @if (status()?.enabled) { <svg lucideShieldCheck class="size-5 text-brand-600" aria-hidden="true"></svg> } @else { <svg lucideShieldAlert class="size-5 text-stone-400" aria-hidden="true"></svg> }
        {{ 'Two-step sign-in' | t }}
      </h2>
      <p class="mt-1 text-sm text-stone-500">{{ 'Signing in also asks for a code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password…), so a stolen password is not enough.' | t }}</p>
      @if (me.security.mfaRequired && !me.security.mfaEnabled) {
        <fh-alert tone="info" class="mt-4">{{ 'As a platform administrator you must turn this on to use the administration pages.' | t }}</fh-alert>
      }
      @if (message(); as m) { <fh-alert [tone]="m.tone" class="mt-4">{{ m.text }}</fh-alert> }

      @if (status(); as st) {
        @switch (step()) {
          @case ('idle') {
            @if (st.enabled) {
              <p class="mt-4 text-sm">{{ 'On since {date}' | t: { date: (st.enabledAt | date: 'mediumDate') } }} · <strong>{{ st.recoveryCodesLeft }}</strong> {{ codesLeftText(st.recoveryCodesLeft) }}</p>
              @if (st.recoveryCodesLeft <= 3) { <!-- i18n-ignore -->
                <fh-alert tone="info" class="mt-3">{{ 'You are running out of recovery codes. Make new ones and keep them safe.' | t }}</fh-alert>
              }
              <div class="mt-4 flex flex-wrap gap-2">
                <button type="button" class="btn-secondary" (click)="begin('confirm-codes')">{{ 'New recovery codes' | t }}</button>
                <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="begin('confirm-off')">{{ 'Turn off' | t }}</button>
              </div>
            } @else {
              <button type="button" class="btn-primary mt-4" (click)="begin('confirm-on')">{{ 'Turn on two-step sign-in' | t }}</button>
            }
          }
          @case ('scan') {
            @if (setup(); as s) {
              <ol class="mt-4 list-decimal space-y-4 pl-5 text-sm">
                <li>
                  {{ 'Scan this QR code with your authenticator app.' | t }}
                  <img [src]="qr()" [alt]="'QR code for your authenticator app' | t" class="mt-3 size-48 rounded-lg bg-white p-2 ring-1 ring-stone-200" />
                  <details class="mt-2">
                    <summary class="cursor-pointer text-brand-700 dark:text-brand-300">{{ "Can't scan it? Type this key instead" | t }}</summary>
                    <p class="mt-2 break-all rounded-lg bg-stone-100 p-2 font-mono text-sm tracking-wider dark:bg-stone-800" [attr.aria-label]="'Key' | t">{{ grouped(s.secret) }}</p>
                  </details>
                </li>
                <li>
                  <form class="flex flex-wrap items-end gap-2" (ngSubmit)="enable()">
                    <div>
                      <label class="label" for="mfa-enable-code">{{ 'Type the 6-digit code it shows' | t }}</label>
                      <input id="mfa-enable-code" name="code" class="input w-40 text-center font-mono text-lg tracking-[0.3em]" inputmode="numeric" autocomplete="one-time-code" maxlength="7" [(ngModel)]="code" required />
                    </div>
                    <button type="submit" class="btn-primary" [disabled]="busy()">{{ 'Turn on' | t }}</button>
                    <button type="button" class="btn-ghost" (click)="reset()">{{ 'Cancel' | t }}</button>
                  </form>
                </li>
              </ol>
            }
          }
          @case ('codes') {
            <div class="mt-4 rounded-xl border border-gold-300 bg-gold-100/50 p-4 dark:border-gold-700 dark:bg-gold-700/10">
              <p class="text-sm font-medium">{{ 'Save these recovery codes somewhere safe — on paper, or in a password manager.' | t }}</p>
              <p class="mt-1 text-sm text-stone-600 dark:text-stone-300">{{ 'If you lose your phone, each code lets you sign in once. They will not be shown again.' | t }}</p>
              <ul class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-2" [attr.aria-label]="'Recovery codes' | t">
                @for (c of codes(); track c) { <li>{{ c }}</li> }
              </ul>
              <div class="mt-4 flex flex-wrap gap-2">
                <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="copy()"><svg lucideCopy class="size-4"></svg> {{ 'Copy' | t }}</button>
                <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="download()"><svg lucideDownload class="size-4"></svg> {{ 'Download' | t }}</button>
                <button type="button" class="btn-primary !py-1.5 text-sm" (click)="reset()">{{ 'I have saved them' | t }}</button>
              </div>
            </div>
          }
          @default {
            <form class="mt-4 space-y-4" (ngSubmit)="confirm()">
              <p class="text-sm">{{ step() === 'confirm-on' ? ('First, confirm it is you.' | t) : step() === 'confirm-off' ? ('To turn two-step sign-in off, confirm it is you.' | t) : ('New codes replace the old ones. Confirm it is you.' | t) }}</p>
              @if (me.security.hasPassword) {
                <div>
                  <label class="label" for="mfa-password">{{ 'Password' | t }}</label>
                  <fh-password-reveal><input id="mfa-password" name="password" type="password" class="input" autocomplete="current-password" [(ngModel)]="password" required /></fh-password-reveal>
                </div>
              }
              @if (step() !== 'confirm-on') {
                <div>
                  <label class="label" for="mfa-confirm-code">{{ 'Code from your authenticator app, or a recovery code' | t }}</label>
                  <input id="mfa-confirm-code" name="code" class="input w-56 font-mono" autocomplete="one-time-code" maxlength="32" [(ngModel)]="code" required />
                </div>
              }
              <div class="flex gap-2">
                <button type="submit" [class]="step() === 'confirm-off' ? 'btn-danger' : 'btn-primary'" [disabled]="busy()">{{ step() === 'confirm-off' ? ('Turn off' | t) : ('Continue' | t) }}</button>
                <button type="button" class="btn-ghost" (click)="reset()">{{ 'Cancel' | t }}</button>
              </div>
            </form>
          }
        }
      } @else {
        <fh-spinner class="mt-4" />
      }
    </section>

    @if (googleAvailable() || me.security.google) {
    <section class="card p-6" aria-labelledby="google-heading">
      <h2 id="google-heading" class="text-lg font-semibold">{{ 'Google account' | t }}</h2>
      @if (googleMessage(); as m) { <fh-alert [tone]="m.tone" class="mt-4">{{ m.text }}</fh-alert> }
      @if (me.security.google; as g) {
        <p class="mt-2 text-sm">{{ 'You can sign in with' | t }} <strong>{{ g.email }}</strong>.</p>
        @if (me.security.hasPassword) {
          <button type="button" class="btn-secondary mt-4" (click)="unlink()" [disabled]="busy()">{{ 'Remove Google sign-in' | t }}</button>
        } @else {
          <p class="mt-2 text-sm text-stone-500">{{ 'To remove it, first set a password below so you can still sign in.' | t }}</p>
        }
      } @else {
        <p class="mt-1 text-sm text-stone-500">{{ 'Link your Google account to sign in with one click.' | t }}</p>
        <div class="mt-4 max-w-xs"><fh-google-button mode="link" next="/settings" [label]="'Link a Google account' | t" /></div>
      }
    </section>
    }
  `,
  host: { class: 'grid gap-6 lg:grid-cols-2' },
})
export class SecuritySettingsComponent {
  /** The `google` query parameter after coming back from linking. */
  readonly googleResult = input<string | undefined>();

  protected readonly auth = inject(AuthStore);
  private readonly api = inject(AuthApi);
  protected readonly status = signal<MfaStatus | null>(null);
  protected readonly step = signal<Step>('idle');
  protected readonly setup = signal<TotpSetupResponse | null>(null);
  protected readonly codes = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly message = signal<Message | null>(null);
  private readonly googleOverride = signal<Message | null | undefined>(undefined);
  protected readonly googleMessage = computed(() => (this.googleOverride() !== undefined ? this.googleOverride() : this.googleResultMessage()));
  private googleResultMessage(): Message | null {
    const r = GOOGLE_RESULTS[this.googleResult() ?? ''];
    return r ? { ...r, text: t(r.text) } : null;
  }
  protected readonly qr = computed(() => (this.setup() ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.setup()!.qrSvg)}` : ''));
  protected readonly googleAvailable = signal(false);
  protected password = '';
  protected code = '';

  constructor() {
    void this.load();
    void inject(PublicConfigService).get().then((c) => this.googleAvailable.set(c.google));
  }

  private async load(): Promise<void> {
    try {
      this.status.set(await this.api.mfaStatus());
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }

  private async refreshUser(): Promise<void> {
    this.auth.setUser(await this.api.me());
  }

  protected codesLeftText(count: number): string {
    return t('{count, plural, one {recovery code left} other {recovery codes left}}', { count });
  }

  protected grouped(secret: string): string {
    return secret.replace(/(.{4})/g, '$1 ').trim();
  }

  protected begin(step: Step): void {
    this.password = '';
    this.code = '';
    this.message.set(null);
    this.step.set(step);
  }

  protected reset(): void {
    this.begin('idle');
    this.setup.set(null);
    this.codes.set([]);
  }

  private proof(): MfaConfirmRequest {
    const proof: MfaConfirmRequest = {};
    if (this.password) proof.password = this.password;
    const code = this.code.trim();
    if (code) {
      if (/^\d{3}\s?\d{3}$/.test(code)) proof.code = code.replace(/\s/g, '');
      else proof.recoveryCode = code;
    }
    return proof;
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await action();
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected confirm(): Promise<void> {
    return this.run(async () => {
      const step = this.step();
      if (step === 'confirm-on') {
        this.setup.set(await this.api.mfaSetup(this.proof()));
        this.code = '';
        this.step.set('scan');
      } else if (step === 'confirm-off') {
        await this.api.mfaDisable(this.proof());
        this.reset();
        this.message.set({ tone: 'info', text: t('Two-step sign-in is off. Signing in now needs only your password.') });
        await Promise.all([this.load(), this.refreshUser()]);
      } else {
        this.codes.set(await this.api.newRecoveryCodes(this.proof()));
        this.step.set('codes');
        await this.load();
      }
    });
  }

  protected enable(): Promise<void> {
    return this.run(async () => {
      this.codes.set(await this.api.mfaEnable(this.code.replace(/\s/g, '')));
      this.setup.set(null);
      this.step.set('codes');
      this.message.set({ tone: 'success', text: t('Two-step sign-in is on. Other devices were signed out.') });
      await Promise.all([this.load(), this.refreshUser()]);
    });
  }

  protected async copy(): Promise<void> {
    await navigator.clipboard?.writeText(this.codes().join('\n'));
    this.message.set({ tone: 'success', text: t('Recovery codes copied.') });
  }

  protected download(): void {
    const text = `${t('Family Heritage recovery codes for {email}', { email: this.auth.user()!.email })}\n${t('Each code works once.')}\n\n${this.codes().join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'family-heritage-recovery-codes.txt' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected async unlink(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.unlinkGoogle();
      this.googleOverride.set({ tone: 'info', text: t('Google sign-in removed.') });
      await this.refreshUser();
    } catch (err) {
      this.googleOverride.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }
}
