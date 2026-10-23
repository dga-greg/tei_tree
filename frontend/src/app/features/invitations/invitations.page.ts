import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideMail, LucideSend } from '@lucide/angular';
import { FAMILY_ROLE_LABELS, FAMILY_ROLES, type FamilyRole, type InvitationStatus, type InvitationView, type PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { CollaborationApi } from '../../core/collaboration/collaboration.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-invitations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, AlertComponent, FormFieldComponent, PersonPickerComponent, SpinnerComponent, NoFamilyComponent, LucideMail, LucideSend, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (!context.can('invitation.manage')) {
      <fh-alert tone="info">{{ 'Only family administrators can invite relatives. Ask an administrator to send you an invitation link for others.' | t }}</fh-alert>
    } @else {
      <header class="mb-6">
        <h1 class="text-3xl font-semibold">{{ 'Invitations' | t }}</h1>
        <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ 'Invite relatives by e-mail. Links expire after 14 days and only work for the address invited. They can join with an existing account or create one.' | t }}</p>
      </header>

      @if (message(); as m) { <fh-alert [tone]="m.tone" class="mb-4">{{ m.text }}</fh-alert> }

      <form class="card mb-8 grid gap-4 p-5 lg:grid-cols-2" [formGroup]="form" (ngSubmit)="send()" novalidate aria-labelledby="invite-h">
        <h2 id="invite-h" class="text-lg font-semibold lg:col-span-2">{{ 'Invite a relative' | t }}</h2>
        <fh-form-field [label]="'E-mail address' | t" [control]="form.controls.email" #em>
          <input class="input" type="email" formControlName="email" [attr.id]="em.controlId" [attr.aria-describedby]="em.describedBy()" [attr.aria-invalid]="!!em.error()" />
        </fh-form-field>
        <fh-form-field [label]="'Role' | t" [control]="form.controls.role" #r>
          <select class="input" formControlName="role" [attr.id]="r.controlId">
            @for (role of roles; track role) { <option [value]="role">{{ roleLabels[role] | t }}</option> }
          </select>
        </fh-form-field>
        <fh-person-picker [familyId]="context.active()!.id" [label]="'They are probably… (optional)' | t" (picked)="suggested.set($event)" />
        <fh-form-field [label]="'Personal message (optional)' | t" [control]="form.controls.message" #msg>
          <input class="input" formControlName="message" [attr.id]="msg.controlId" [placeholder]="'e.g. Come and add your branch of the family!' | t" />
        </fh-form-field>
        <div class="lg:col-span-2">
          <button type="submit" class="btn-primary" [disabled]="busy()"><svg lucideSend class="size-4"></svg> {{ 'Send invitation' | t }}</button>
        </div>
      </form>

      <section class="card overflow-hidden" aria-labelledby="sent-h">
        <h2 id="sent-h" class="p-5 pb-3 text-lg font-semibold">{{ 'Sent invitations' | t }}</h2>
        @if (invitations() === null) {
          <div class="p-5"><fh-spinner /></div>
        } @else {
          <ul class="divide-y divide-stone-200 dark:divide-stone-800">
            @for (i of invitations(); track i.id) {
              <li class="flex flex-wrap items-center gap-3 px-5 py-3">
                <svg lucideMail class="size-5 text-stone-400"></svg>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium">{{ i.email }}</p>
                  <p class="text-xs text-stone-500">
                    {{ roleLabels[i.role] | t }}@if (i.suggestedProfile) { · {{ 'as {name}' | t: { name: i.suggestedProfile.displayName } }} } · {{ 'sent {date}' | t: { date: (i.createdAt | date: 'mediumDate') } }}
                    @if (i.status === 'pending') { · {{ 'expires {date}' | t: { date: (i.expiresAt | date: 'mediumDate') } }} }
                  </p>
                </div>
                <span class="badge" [class]="badge(i.status)">{{ statusLabel(i.status) }}</span>
                @if (i.status === 'pending') {
                  <button type="button" class="btn-ghost !py-1.5 text-xs" (click)="resend(i)">{{ 'Send again' | t }}</button>
                  <button type="button" class="btn-ghost !py-1.5 text-xs text-red-700 dark:text-red-400" (click)="revoke(i)">{{ 'Revoke' | t }}</button>
                }
              </li>
            } @empty {
              <li class="px-5 pb-5 text-sm text-stone-500">{{ 'No invitations yet.' | t }}</li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class InvitationsPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(CollaborationApi);
  protected readonly roles = FAMILY_ROLES;
  protected readonly roleLabels = FAMILY_ROLE_LABELS;
  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    role: ['family_member' as FamilyRole],
    message: [''],
  });
  protected readonly suggested = signal<PersonCard | null>(null);
  protected readonly invitations = signal<InvitationView[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);

  constructor() {
    effect(() => {
      const f = this.context.active();
      if (f && this.context.can('invitation.manage')) untracked(() => void this.load(f.id));
    });
  }

  private async load(familyId: string): Promise<void> {
    this.invitations.set(await this.api.invitations(familyId).catch(() => []));
  }

  protected statusLabel(status: InvitationStatus): string {
    const labels: Record<InvitationStatus, string> = { pending: t('pending'), accepted: t('accepted'), revoked: t('revoked'), expired: t('expired') };
    return labels[status] ?? status;
  }

  protected badge(status: string): string {
    return status === 'pending' ? 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200' : status === 'accepted' ? 'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300';
  }

  protected async send(): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const familyId = this.context.active()!.id;
    const v = this.form.getRawValue();
    this.busy.set(true);
    try {
      await this.api.invite(familyId, { email: v.email.trim(), role: v.role, message: v.message.trim() || undefined, suggestedProfileId: this.suggested()?.id ?? null });
      this.message.set({ tone: 'success', text: t('Invitation sent to {email}.', { email: v.email.trim() }) });
      this.form.reset({ email: '', role: 'family_member', message: '' });
      await this.load(familyId);
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected async resend(i: InvitationView): Promise<void> {
    await this.api.resendInvitation(this.context.active()!.id, i.id);
    this.message.set({ tone: 'success', text: t('A new link was sent to {email}. The previous link no longer works.', { email: i.email }) });
    await this.load(this.context.active()!.id);
  }

  protected async revoke(i: InvitationView): Promise<void> {
    if (!confirm(t('Revoke the invitation to {email}?', { email: i.email }))) return;
    await this.api.revokeInvitation(this.context.active()!.id, i.id);
    await this.load(this.context.active()!.id);
  }
}
