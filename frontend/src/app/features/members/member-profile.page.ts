import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideCamera, LucidePencil, LucidePlus, LucideTrash2, LucideX } from '@lucide/angular';
import { PARENT_CHILD_SUBTYPE_LABELS, PARTNERSHIP_STATUS_LABELS, PARTNERSHIP_SUBTYPE_LABELS, type MemberView, type RelativeLink, type SiblingLink } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { ArchiveApi } from '../../core/archive/archive.api';
import { MembersApi } from '../../core/members/members.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ConfirmDialogComponent, type ConfirmData } from '../../shared/ui/confirm-dialog.component';
import { FamilyCodeComponent } from '../../shared/ui/family-code.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { ProfileNotice } from './member-edit.page';
import { cropPhoto, uploadProfilePhoto } from './profile-photo';
import { RelationshipDialogComponent, type RelationKind, type RelationshipDialogData, type RelationshipDialogResult } from './relationship-dialog.component';

interface RelativeGroup {
  key: 'parents' | 'partners' | 'children' | 'siblings';
  title: string;
  /** Accessible names of the "Existing" and "New" buttons. */
  linkLabel: string;
  newLabel: string;
  kind: RelationKind | null;
  newParam: string | null;
  links: (RelativeLink | SiblingLink)[];
}

@Component({
  selector: 'fh-member-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, SpinnerComponent, PersonAvatarComponent, FamilyCodeComponent, LucidePencil, LucideTrash2, LucidePlus, LucideX, LucideCamera, TranslatePipe],
  template: `
    @if (error(); as e) {
      <fh-alert>{{ e }}</fh-alert>
      <a routerLink="/members" class="btn-secondary mt-4">{{ 'Back to family members' | t }}</a>
    } @else if (member(); as m) {
      <nav class="mb-4 text-sm" [attr.aria-label]="'Breadcrumb' | t"><a routerLink="/members" class="text-brand-700 hover:underline dark:text-brand-300">{{ 'Family members' | t }}</a><span class="mx-1.5 text-stone-400" aria-hidden="true">/</span>{{ m.displayName }}</nav>

      <header class="card relative overflow-hidden p-6 sm:p-8">
        <div class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-gold-300 via-brand-400 to-brand-700" aria-hidden="true"></div>
        <div class="flex flex-col gap-5 sm:flex-row sm:flex-wrap sm:items-center">
          @if (canChangePhoto()) {
            <div class="relative w-fit shrink-0">
              <fh-person-avatar [name]="m.displayName" [photoUrl]="m.photoUrl" size="lg" />
              <label class="absolute -right-1 -bottom-1 grid size-8 cursor-pointer place-items-center rounded-full border-2 border-white bg-brand-700 text-white shadow-sm hover:bg-brand-800 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500 dark:border-stone-900" [title]="(m.photoUrl ? 'Change photo' : 'Add photo') | t">
                @if (photoBusy()) { <span class="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"></span> } @else { <svg lucideCamera class="size-4"></svg> }
                <span class="sr-only">{{ (m.photoUrl ? 'Change photo' : 'Add photo') | t }}</span>
                <input type="file" class="sr-only" accept="image/*" data-testid="profile-photo-input" [disabled]="photoBusy()" (change)="changePhoto(m, $any($event.target))" />
              </label>
            </div>
          } @else {
            <fh-person-avatar [name]="m.displayName" [photoUrl]="m.photoUrl" size="lg" />
          }
          <!-- The name keeps a readable width; the actions wrap below it when there are many. -->
          <div class="min-w-[min(100%,16rem)] flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <fh-family-code [code]="m.familyCode" />
              @if (m.isFounder) { <span class="badge bg-gold-100 text-gold-700">{{ 'Family head' | t }}</span> }
              @if (m.vitalStatus === 'deceased') { <span class="badge bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ 'Deceased' | t }}</span> }
              @if (m.vitalStatus === 'living') { <span class="badge bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200">{{ 'Living' | t }}</span> }
            </div>
            <h1 class="mt-2 text-3xl font-semibold sm:text-4xl">{{ m.fullName }}</h1>
            @if (m.preferredName) { <p class="text-stone-500">{{ 'Known as {name}' | t: { name: m.preferredName } }}</p> }
            <p class="mt-1 text-stone-600 dark:text-stone-400">{{ span(m) }}@if (m.residence) { · {{ m.residence }} }</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <a routerLink="/tree" [queryParams]="{ focus: m.id }" class="btn-secondary">{{ 'View in tree' | t }}</a>
            @if (m.viewerCan.update) {
              <a [routerLink]="['/members', m.id, 'edit']" class="btn-secondary"><svg lucidePencil class="size-4"></svg> {{ 'Edit' | t }}</a>
            }
            @if (!m.isFounder && m.viewerCan.delete) {
              <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="remove(m)"><svg lucideTrash2 class="size-4"></svg><span class="sr-only sm:not-sr-only">{{ 'Remove' | t }}</span></button>
            }
          </div>
        </div>
      </header>

      @if (notice(); as n) { <fh-alert [tone]="n.tone" class="mt-4">{{ n.text }}</fh-alert> }

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div class="space-y-6">
          <section class="card p-6" aria-labelledby="facts-h">
            <h2 id="facts-h" class="text-lg font-semibold">{{ 'Details' | t }}</h2>
            <dl class="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              @for (f of facts(); track f.label) {
                <div><dt class="text-xs font-medium uppercase tracking-wide text-stone-500">{{ f.label }}</dt><dd class="mt-0.5">{{ f.value }}</dd></div>
              }
            </dl>
          </section>

          <section class="card p-6" aria-labelledby="other-h">
            <h2 id="other-h" class="text-lg font-semibold">{{ 'Other details' | t }}</h2>
            @if (m.attributes.length) {
              <dl class="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2" data-testid="attributes">
                @for (a of m.attributes; track a.name) {
                  <div><dt class="text-xs font-medium uppercase tracking-wide text-stone-500">{{ a.name }}</dt><dd class="mt-0.5 whitespace-pre-line">{{ a.value || '—' }}</dd></div>
                }
              </dl>
            } @else {
              <p class="mt-2 text-sm text-stone-500">{{ 'None recorded yet.' | t }}@if (m.viewerCan.update) { <a class="ml-1 font-medium text-brand-700 hover:underline dark:text-brand-300" [routerLink]="['/members', m.id, 'edit']">{{ 'Add a detail' | t }}</a> }</p>
            }
          </section>
        </div>

        <aside class="space-y-4" [attr.aria-label]="'Relatives' | t">
          @for (g of groups(); track g.key) {
            <section class="card p-5" [attr.aria-labelledby]="'rel-' + g.key">
              <div class="flex items-center justify-between gap-2">
                <h2 [id]="'rel-' + g.key" class="text-lg font-semibold">{{ g.title }}</h2>
                @if (g.kind && m.viewerCan.manageRelationships) {
                  <div class="flex gap-1">
                    <button type="button" class="btn-ghost !px-2 !py-1 text-xs" (click)="link(m, g.kind)" [attr.aria-label]="g.linkLabel">
                      <svg lucidePlus class="size-3.5"></svg> {{ 'Existing' | t }}
                    </button>
                    @if (m.viewerCan.update) {
                      <a class="btn-ghost !px-2 !py-1 text-xs" [routerLink]="['/members/new']" [queryParams]="newParams(g.newParam!, m.id)" [attr.aria-label]="g.newLabel">
                        <svg lucidePlus class="size-3.5"></svg> {{ 'New' | t }}
                      </a>
                    }
                  </div>
                }
              </div>
              @if (g.links.length === 0) {
                <p class="mt-2 text-sm text-stone-500">{{ g.key === 'siblings' ? ('None recorded (siblings are found through shared parents).' | t) : ('None recorded.' | t) }}</p>
              } @else {
                <ul class="mt-3 space-y-2">
                  @for (l of g.links; track l.person.id) {
                    <li class="flex items-center gap-3">
                      <a [routerLink]="['/members', l.person.id]" class="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 hover:bg-stone-50 dark:hover:bg-stone-800/60">
                        <fh-person-avatar [name]="l.person.displayName" [photoUrl]="l.person.photoUrl" size="sm" />
                        <span class="min-w-0">
                          <span class="block truncate text-sm font-medium">{{ l.person.displayName }}</span>
                          <span class="block truncate text-xs text-stone-500">{{ describe(l) }}</span>
                        </span>
                      </a>
                      @if (isEdge(l) && m.viewerCan.manageRelationships) {
                        <button type="button" class="btn-ghost !p-1.5" (click)="unlink(m, l)" [attr.aria-label]="'Remove link to {name}' | t: { name: l.person.displayName }">
                          <svg lucideX class="size-4"></svg>
                        </button>
                      }
                    </li>
                  }
                </ul>
              }
            </section>
          }
        </aside>
      </div>
    } @else {
      <fh-spinner [showLabel]="true" />
    }
  `,
})
export class MemberProfilePage {
  /** Route parameter (component input binding). */
  readonly id = input.required<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly membersApi = inject(MembersApi);
  private readonly archive = inject(ArchiveApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly member = signal<MemberView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  protected readonly span = lifespan;
  protected readonly photoBusy = signal(false);
  protected readonly canChangePhoto = computed(() => !!this.member()?.viewerCan.update && this.context.can('media.upload'));

  protected readonly facts = computed(() => {
    const m = this.member();
    if (!m) return [];
    const status = { living: t('Living'), deceased: t('Deceased'), unknown: t('Unknown') };
    const gender: Record<string, string> = { male: t('Male'), female: t('Female'), other: t('Other'), non_binary: t('Other'), undisclosed: t('Not recorded') };
    const rows: { label: string; value: string }[] = [];
    const add = (label: string, value: string | null | undefined) => rows.push({ label, value: value || '—' });
    add(t('Family ID'), m.familyCode ?? t('Not linked to the family yet'));
    add(t('Common name'), m.preferredName);
    add(t('Gender'), m.gender ? gender[m.gender] : null);
    add(t('Place of stay'), m.residence);
    add(t('Date of birth'), formatFuzzyDate(m.birthDate));
    add(t('Status'), m.vitalStatus ? status[m.vitalStatus] : null);
    if (m.vitalStatus === 'deceased') add(t('Date of death'), formatFuzzyDate(m.deathDate));
    return rows;
  });

  protected readonly groups = computed<RelativeGroup[]>(() => {
    const r = this.member()?.relatives;
    if (!r) return [];
    return [
      { key: 'parents', title: t('Parents'), linkLabel: t('Link an existing person as parents'), newLabel: t('Add a new person as parents'), kind: 'parent', newParam: 'parentOf', links: r.parents },
      { key: 'partners', title: t('Husband or wife'), linkLabel: t('Link an existing person as husband or wife'), newLabel: t('Add a new husband or wife'), kind: 'partner', newParam: 'partnerOf', links: r.partners },
      { key: 'children', title: t('Children'), linkLabel: t('Link an existing person as children'), newLabel: t('Add a new person as children'), kind: 'child', newParam: 'childOf', links: r.children },
      { key: 'siblings', title: t('Siblings'), linkLabel: '', newLabel: '', kind: null, newParam: null, links: r.siblings },
    ];
  });

  constructor() {
    const after = this.router.currentNavigation()?.extras.state?.['notice'] as ProfileNotice | undefined;
    if (after) this.notice.set(after);
    effect(() => {
      const id = this.id();
      const family = this.context.active();
      if (family) untracked(() => void this.load(family.id, id));
    });
  }

  private async load(familyId: string, id: string): Promise<void> {
    try {
      this.member.set(await this.membersApi.get(familyId, id));
      this.error.set(null);
    } catch (err) {
      const e = ApiError.from(err);
      this.error.set(e.code === 'NOT_FOUND' ? t('This person could not be found in the active family.') : e.message);
    }
  }

  protected async changePhoto(m: MemberView, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const cropped = await cropPhoto(this.dialog, file);
    if (!cropped) return;
    this.photoBusy.set(true);
    this.notice.set(null);
    try {
      const media = await uploadProfilePhoto(this.archive, m.familyId, m, cropped);
      if (media) this.notice.set({ tone: 'success', text: t("This is now {name}'s photo.", { name: m.displayName }) });
      await this.load(m.familyId, m.id);
    } catch (err) {
      this.notice.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected isEdge(l: RelativeLink | SiblingLink): l is RelativeLink {
    return 'relationshipId' in l;
  }

  protected newParams(param: string, id: string): Record<string, string> {
    return { [param]: id };
  }

  protected describe(l: RelativeLink | SiblingLink): string {
    const life = [l.person.familyCode, lifespan(l.person)].filter(Boolean).join(' · ');
    if (!this.isEdge(l)) {
      const kind = l.kind === 'full' ? t('Full sibling') : l.kind === 'half' ? t('Half-sibling') : t('Step / adoptive sibling');
      return [kind, life].filter(Boolean).join(' · ');
    }
    const type =
      l.subtype in PARTNERSHIP_SUBTYPE_LABELS && l.status
        ? `${t(PARTNERSHIP_SUBTYPE_LABELS[l.subtype as keyof typeof PARTNERSHIP_SUBTYPE_LABELS])} · ${t(PARTNERSHIP_STATUS_LABELS[l.status])}`
        : t(PARENT_CHILD_SUBTYPE_LABELS[l.subtype as keyof typeof PARENT_CHILD_SUBTYPE_LABELS]);
    const certainty = l.verification === 'verified' ? '' : l.verification === 'disputed' ? t('disputed') : t('unverified');
    return [type, certainty, life].filter(Boolean).join(' · ');
  }

  protected async link(m: MemberView, kind: RelationKind): Promise<void> {
    const r = m.relatives;
    const exclude = [m.id, ...[...r.parents, ...r.children, ...r.partners].map((l) => l.person.id)];
    const ref = this.dialog.open<RelationshipDialogResult, RelationshipDialogData>(RelationshipDialogComponent, {
      data: { familyId: m.familyId, person: { id: m.id, displayName: m.displayName }, kind, exclude },
    });
    const result = await firstValueFrom(ref.closed);
    if (result === 'saved') {
      this.notice.set({ tone: 'success', text: t('Relationship saved.') });
      await this.load(m.familyId, m.id);
    }
  }

  private confirm(data: ConfirmData): Promise<boolean | undefined> {
    return firstValueFrom(this.dialog.open<boolean, ConfirmData>(ConfirmDialogComponent, { data, role: 'alertdialog' }).closed);
  }

  protected async unlink(m: MemberView, l: RelativeLink): Promise<void> {
    const ok = await this.confirm({
      title: t('Remove this relationship?'),
      message: t('The link between {a} and {b} will be removed. Both people stay in the family and keep their family IDs.', { a: m.displayName, b: l.person.displayName }),
      confirmLabel: t('Remove link'),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.membersApi.removeRelationship(m.familyId, l.relationshipId);
      await this.load(m.familyId, m.id);
    } catch (err) {
      this.notice.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }

  protected async remove(m: MemberView): Promise<void> {
    const ok = await this.confirm({
      title: t('Remove {name}?', { name: m.displayName }),
      message: t('Their profile and all their links will be removed from the family tree. Their family ID is not given to anyone else.'),
      confirmLabel: t('Remove person'),
      danger: true,
    });
    if (!ok) return;
    try {
      await this.membersApi.remove(m.familyId, m.id);
      void this.context.refresh();
      await this.router.navigateByUrl('/members');
    } catch (err) {
      this.notice.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }
}
