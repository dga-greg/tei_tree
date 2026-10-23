import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FAMILY_ROLE_LABELS, FAMILY_ROLES, type BranchView, type FamilyRole, type MembershipView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { CollaborationApi } from '../../core/collaboration/collaboration.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { TreeApi } from '../../core/tree/tree.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-members-access-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe, AlertComponent, SpinnerComponent, NoFamilyComponent, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (!context.can('membership.manage')) {
      <fh-alert tone="info">{{ 'Only family administrators can manage who has access.' | t }}</fh-alert>
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Members & roles' | t }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ 'Accounts with access to the {name}. Moderators can review suggestions and edit people — everywhere, or only in the branches you choose.' | t: { name: context.active()!.name } }}</p>
        </div>
        <a routerLink="/invitations" class="btn-secondary">{{ 'Invite a relative' | t }}</a>
      </header>
      @if (message(); as m) { <fh-alert [tone]="m.tone" class="mb-4">{{ m.text }}</fh-alert> }
      @if (rows() === null) {
        <fh-spinner [showLabel]="true" />
      } @else {
        <ul class="space-y-3">
          @for (m of rows(); track m.id) {
            <li class="card flex flex-wrap items-start gap-4 p-4">
              <div class="min-w-48 flex-1">
                <p class="font-semibold">{{ m.user.displayName }}@if (m.isSelf) { <span class="badge ml-1 bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ 'You' | t }}</span> }</p>
                <p class="text-sm text-stone-500">{{ m.user.email }} · {{ 'joined {date}' | t: { date: (m.joinedAt | date: 'mediumDate') } }}</p>
                <p class="mt-1 text-sm">
                  @if (m.profile; as p) {
                    {{ 'Linked to' | t }} <a [routerLink]="['/members', p.id]" class="font-medium text-brand-700 hover:underline dark:text-brand-300">{{ p.displayName }}</a>
                    <button type="button" class="ml-1 text-xs text-stone-500 underline" (click)="unlink(m)">{{ 'unlink' | t }}</button>
                  } @else {
                    <span class="text-stone-500">{{ 'Not linked to a profile' | t }}</span>
                  }
                </p>
              </div>
              <div class="flex flex-wrap items-end gap-3">
                <div>
                  <label class="label !mb-1 text-xs" [for]="'role-' + m.id">{{ 'Role' | t }}</label>
                  <select class="input !py-1.5" [id]="'role-' + m.id" [ngModel]="m.role" (ngModelChange)="setRole(m, $event)">
                    @for (r of roles; track r) { <option [value]="r">{{ roleLabels[r] | t }}</option> }
                  </select>
                </div>
                @if (m.role === 'family_moderator') {
                  <fieldset>
                    <legend class="label !mb-1 text-xs">{{ 'Branches' | t }}</legend>
                    <div class="flex flex-wrap gap-2 text-sm">
                      @for (b of branches(); track b.id) {
                        <label class="flex items-center gap-1.5"><input type="checkbox" class="accent-brand-700" [checked]="m.moderatedBranchIds.includes(b.id)" (change)="toggleBranch(m, b.id)" /> {{ b.name }}</label>
                      } @empty {
                        <span class="text-xs text-stone-500">{{ 'No branches — they moderate the whole family.' | t }}</span>
                      }
                    </div>
                    @if (branches().length && !m.moderatedBranchIds.length) { <p class="mt-1 text-xs text-stone-500">{{ 'None selected: the whole family.' | t }}</p> }
                  </fieldset>
                }
                <label class="flex items-center gap-1.5 pb-2 text-sm" [title]="treasurerHint">
                  <input type="checkbox" class="accent-brand-700" [checked]="m.treasurer" (change)="setTreasurer(m, $any($event.target).checked)" /> {{ 'Treasurer' | t }}
                </label>
                <button type="button" class="btn-ghost !py-1.5 text-sm text-red-700 dark:text-red-400" (click)="remove(m)">{{ m.isSelf ? ('Leave' | t) : ('Remove' | t) }}</button>
              </div>
            </li>
          }
        </ul>
      }
    }
  `,
})
export class MembersAccessPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(CollaborationApi);
  private readonly treeApi = inject(TreeApi);
  protected readonly roles = FAMILY_ROLES;
  protected readonly roleLabels = FAMILY_ROLE_LABELS;
  protected readonly treasurerHint = t("Treasurers keep the family funds' accounts, whatever their role.");
  protected readonly rows = signal<MembershipView[] | null>(null);
  protected readonly branches = signal<BranchView[]>([]);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);

  constructor() {
    effect(() => {
      const f = this.context.active();
      if (!f || !this.context.can('membership.manage')) return;
      untracked(() => {
        void this.api.memberships(f.id).then((r) => this.rows.set(r), (e: unknown) => this.fail(e));
        void this.treeApi.branches(f.id).then((b) => this.branches.set(b), () => undefined);
      });
    });
  }

  private fail(err: unknown): void {
    this.message.set({ tone: 'error', text: ApiError.from(err).message });
  }

  private async update(m: MembershipView, body: { role?: FamilyRole; moderatedBranchIds?: string[]; treasurer?: boolean }, success: string): Promise<void> {
    try {
      this.rows.set(await this.api.updateMembership(this.context.active()!.id, m.id, body));
      this.message.set({ tone: 'success', text: success });
    } catch (err) {
      this.fail(err);
      this.rows.set(await this.api.memberships(this.context.active()!.id));
    }
  }

  protected setTreasurer(m: MembershipView, treasurer: boolean): Promise<void> {
    return this.update(m, { treasurer }, treasurer ? t("{name} can now keep the family funds' accounts.", { name: m.user.displayName }) : t('{name} is no longer a treasurer.', { name: m.user.displayName }));
  }

  protected setRole(m: MembershipView, role: FamilyRole): Promise<void> {
    const name = m.user.displayName;
    const done: Record<FamilyRole, string> = {
      family_admin: t('{name} is now a family administrator.', { name }),
      family_moderator: t('{name} is now a family moderator.', { name }),
      family_member: t('{name} is now a family member.', { name }),
    };
    return this.update(m, { role }, done[role]);
  }

  protected toggleBranch(m: MembershipView, branchId: string): Promise<void> {
    const ids = m.moderatedBranchIds.includes(branchId) ? m.moderatedBranchIds.filter((x) => x !== branchId) : [...m.moderatedBranchIds, branchId];
    return this.update(m, { moderatedBranchIds: ids }, t('Branches updated.'));
  }

  protected async unlink(m: MembershipView): Promise<void> {
    if (!confirm(t('Unlink {name} from {profile}?', { name: m.user.displayName, profile: m.profile?.displayName }))) return;
    try {
      await this.api.unlinkProfile(this.context.active()!.id, m.id);
      this.rows.set(await this.api.memberships(this.context.active()!.id));
    } catch (err) {
      this.fail(err);
    }
  }

  protected async remove(m: MembershipView): Promise<void> {
    if (!confirm(m.isSelf ? t('Leave this family? You will lose access.') : t("Remove {name}'s access to the family?", { name: m.user.displayName }))) return;
    try {
      await this.api.removeMembership(this.context.active()!.id, m.id);
      if (m.isSelf) {
        await this.context.load();
        return;
      }
      this.rows.set(await this.api.memberships(this.context.active()!.id));
      this.message.set({ tone: 'success', text: t('{name} no longer has access.', { name: m.user.displayName }) });
    } catch (err) {
      this.fail(err);
    }
  }
}
