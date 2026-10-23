import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideMailOpen } from '@lucide/angular';
import { FAMILY_ROLE_LABELS, type PendingInvitation } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { CollaborationApi } from '../../core/collaboration/collaboration.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';

/** Invitations waiting for the signed-in person, so they can join even without the e-mail at hand. Hidden when there are none. */
@Component({
  selector: 'fh-pending-invitations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideMailOpen, AlertComponent, TranslatePipe],
  template: `
    @if (invitations().length) {
      <section class="mb-6 space-y-3" [attr.aria-label]="'Invitations' | t">
        @for (i of invitations(); track i.id) {
          <div class="card flex flex-col gap-4 border-gold-300 bg-gold-100/40 p-5 sm:flex-row sm:items-center dark:border-gold-700 dark:bg-gold-700/10">
            <span class="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gold-100 text-gold-700 dark:bg-gold-700/30 dark:text-gold-300" aria-hidden="true">
              <svg lucideMailOpen class="size-5"></svg>
            </span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold">{{ '{name} invited you to join the {family}.' | t: { name: i.invitedBy, family: i.familyName } }}</p>
              <p class="mt-0.5 text-sm text-stone-600 dark:text-stone-400">{{ roles[i.role] | t }}@if (i.familyOrigin) { · {{ i.familyOrigin }} }</p>
              @if (i.message) { <p class="mt-1 text-sm italic text-stone-600 dark:text-stone-400">“{{ i.message }}”</p> }
            </div>
            <button type="button" class="btn-primary" (click)="join(i)" [disabled]="busy()">{{ busy() === i.id ? ('Joining…' | t) : ('Join' | t) }}</button>
          </div>
        }
        @if (error(); as e) { <fh-alert>{{ e }}</fh-alert> }
      </section>
    }
  `,
})
export class PendingInvitationsComponent {
  private readonly api = inject(CollaborationApi);
  private readonly families = inject(FamilyContextStore);
  private readonly router = inject(Router);
  protected readonly roles = FAMILY_ROLE_LABELS;
  protected readonly invitations = signal<PendingInvitation[]>([]);
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.api.myInvitations().then(
      (list) => this.invitations.set(list),
      () => undefined, // Supplementary: the dashboard works without it.
    );
  }

  protected async join(i: PendingInvitation): Promise<void> {
    this.busy.set(i.id);
    this.error.set(null);
    try {
      const result = await this.api.acceptMyInvitation(i.id);
      this.invitations.set(this.invitations().filter((x) => x.id !== i.id));
      await this.families.load();
      await this.families.select(result.familyId);
      await this.router.navigateByUrl('/dashboard');
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(null);
    }
  }
}
