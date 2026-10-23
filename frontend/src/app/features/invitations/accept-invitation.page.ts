import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { FamilyRole, InvitationPreview, InvitationStatus } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { AuthApi } from '../../core/auth/auth.api';
import { AuthStore } from '../../core/auth/auth.store';
import { CollaborationApi } from '../../core/collaboration/collaboration.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { AlertComponent } from '../../shared/ui/alert.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Landing page of an invitation e-mail. Works whether or not the visitor is signed in. */
@Component({
  selector: 'fh-accept-invitation-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, SpinnerComponent, TranslatePipe],
  template: `
    @if (preview(); as p) {
      <p class="text-sm font-semibold uppercase tracking-widest text-gold-700 dark:text-gold-300">{{ 'Invitation' | t }}</p>
      <h1 class="mt-2 text-3xl font-semibold">{{ 'Join the {name}' | t: { name: p.familyName } }}</h1>
      <p class="mt-3 text-stone-600 dark:text-stone-300">
        {{ '{name} invited' | t: { name: p.invitedBy } }} <strong>{{ p.email }}</strong> {{ joinAs(p.role) }}@if (p.familyOrigin) { ({{ p.familyOrigin }}) }.
      </p>
      @if (p.message) { <blockquote class="mt-4 border-l-4 border-brand-300 pl-4 italic text-stone-700 dark:text-stone-300">{{ p.message }}</blockquote> }
      @if (p.suggestedProfileName) {
        <p class="mt-4 text-sm text-stone-600 dark:text-stone-300">{{ 'After you join, a request to link your account to' | t }} <strong>{{ p.suggestedProfileName }}</strong> {{ 'will be sent to the family administrators.' | t }}</p>
      }

      @if (error(); as e) { <fh-alert class="mt-6">{{ e }}</fh-alert> }

      @if (p.status !== 'pending') {
        <fh-alert tone="info" class="mt-6">{{ notPending(p.status) }}</fh-alert>
      } @else if (!auth.isAuthenticated()) {
        <p class="mt-6 text-sm">{{ 'Sign in or create an account with' | t }} <strong>{{ p.email }}</strong> {{ 'to accept.' | t }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <a routerLink="/auth/register" [queryParams]="{ returnUrl: here }" class="btn-primary">{{ 'Create an account' | t }}</a>
          <a routerLink="/auth/login" [queryParams]="{ returnUrl: here }" class="btn-secondary">{{ 'Sign in' | t }}</a>
        </div>
      } @else if (auth.user()?.email !== p.email) {
        <fh-alert class="mt-6">{{ 'You are signed in as {current}. This invitation is for {email} — sign out and use that address.' | t: { current: auth.user()?.email, email: p.email } }}</fh-alert>
      } @else {
        <button type="button" class="btn-primary mt-6" (click)="accept()" [disabled]="busy()">{{ busy() ? ('Joining…' | t) : ('Accept and join' | t) }}</button>
      }
    } @else if (error(); as e) {
      <h1 class="text-3xl font-semibold">{{ 'Invitation' | t }}</h1>
      <fh-alert class="mt-6">{{ e }}</fh-alert>
    } @else {
      <fh-spinner [showLabel]="true" />
    }
  `,
})
export class AcceptInvitationPage {
  protected readonly auth = inject(AuthStore);
  private readonly api = inject(CollaborationApi);
  private readonly authApi = inject(AuthApi);
  private readonly families = inject(FamilyContextStore);
  private readonly router = inject(Router);
  private readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  /** Where sign-in and registration bring the person back; `join=1` accepts on arrival. */
  protected readonly here = `/invitations/accept?token=${encodeURIComponent(this.token)}&join=1`;
  private readonly joinOnArrival = inject(ActivatedRoute).snapshot.queryParamMap.get('join') === '1';
  protected readonly preview = signal<InvitationPreview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    if (!this.token) {
      this.error.set(t('This invitation link is incomplete.'));
      return;
    }
    this.api.previewInvitation(this.token).then(
      (p) => {
        this.preview.set(p);
        // Back from signing in or creating an account for this invitation: join straight away.
        if (this.joinOnArrival && p.status === 'pending' && this.auth.user()?.email === p.email) void this.accept();
      },
      (err: unknown) => this.error.set(ApiError.from(err).message),
    );
  }

  /** The end of "X invited you to join as a …" (English keeps the role in lower case). */
  protected joinAs(role: FamilyRole): string {
    const phrases: Record<FamilyRole, string> = {
      family_admin: t('to join as a family administrator'),
      family_moderator: t('to join as a family moderator'),
      family_member: t('to join as a family member'),
    };
    return phrases[role];
  }

  protected notPending(status: InvitationStatus): string {
    const texts: Record<InvitationStatus, string> = {
      pending: t('This invitation is pending. Ask the family administrator for a new one.'),
      accepted: t('This invitation is accepted. Ask the family administrator for a new one.'),
      revoked: t('This invitation is revoked. Ask the family administrator for a new one.'),
      expired: t('This invitation is expired. Ask the family administrator for a new one.'),
    };
    return texts[status];
  }

  protected async accept(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.acceptInvitation(this.token);
      // Opening the invitation confirmed the address.
      this.auth.setUser(await this.authApi.me());
      await this.families.load();
      await this.families.select(result.familyId);
      await this.router.navigateByUrl('/dashboard');
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
