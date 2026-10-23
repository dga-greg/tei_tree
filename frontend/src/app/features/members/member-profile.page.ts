import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideBookOpen, LucideCamera, LucideShieldAlert, LucideGitMerge, LucideFlag, LucideHand, LucideHistory, LucideImagePlus, LucidePencil, LucidePlus, LucideTrash2, LucideX } from '@lucide/angular';
import { canPropose, DEFAULT_LINEAGE_SETTINGS, PARENT_CHILD_SUBTYPE_LABELS, PARTNERSHIP_STATUS_LABELS, PARTNERSHIP_SUBTYPE_LABELS, STORY_KIND_LABELS, type LineageValue, type MediaView, type MemberView, type RelativeLink, type StoryView, type SiblingLink } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { ArchiveApi } from '../../core/archive/archive.api';
import { CollaborationApi } from '../../core/collaboration/collaboration.api';
import { MembersApi } from '../../core/members/members.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ConfirmDialogComponent, type ConfirmData } from '../../shared/ui/confirm-dialog.component';
import { GenerationBadgeComponent } from '../../shared/ui/generation-badge.component';
import { EraBadgeComponent } from '../../shared/ui/era-badge.component';
import { MediaGridComponent } from '../../shared/ui/media-grid.component';
import { MediaViewerComponent, type MediaViewerData } from '../media/media-viewer.component';
import { uploadMode } from '../media/media.page';
import { UploadDialogComponent, type UploadDialogData } from '../media/upload-dialog.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { PromptDialogComponent, type PromptData } from '../../shared/ui/prompt-dialog.component';
import { ReportDialogComponent, type ReportDialogData } from '../../shared/ui/report-dialog.component';
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
  imports: [RouterLink, AlertComponent, SpinnerComponent, GenerationBadgeComponent, EraBadgeComponent, PersonAvatarComponent, LucidePencil, LucideTrash2, LucidePlus, LucideX, LucideFlag, LucideHand, LucideHistory, LucideImagePlus, LucideBookOpen, LucideCamera, LucideShieldAlert, LucideGitMerge, MediaGridComponent, TranslatePipe],
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
              <fh-generation-badge [generation]="m.generation" />
              <fh-era-badge [birthDate]="m.birthDate" />
              @if (m.vitalStatus === 'deceased') { <span class="badge bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ 'Deceased' | t }}</span> }
              @if (m.vitalStatus === 'living') { <span class="badge bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200">{{ 'Living' | t }}</span> }
            </div>
            <h1 class="mt-2 text-3xl font-semibold sm:text-4xl">{{ m.fullName }}</h1>
            @if (m.preferredName) { <p class="text-stone-500">{{ 'Known as {name}' | t: { name: m.preferredName } }}</p> }
            <p class="mt-1 text-stone-600 dark:text-stone-400">{{ span(m) }}@if (m.hometown) { · {{ m.hometown }} }</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <a routerLink="/tree" [queryParams]="{ focus: m.id }" class="btn-secondary">{{ 'View in tree' | t }}</a>
            <a routerLink="/relationships" [queryParams]="{ a: m.id }" class="btn-secondary">{{ 'How are we related?' | t }}</a>
            @if (m.viewerCan.update) {
              <a [routerLink]="['/members', m.id, 'edit']" class="btn-secondary"><svg lucidePencil class="size-4"></svg> {{ 'Edit' | t }}</a>
            } @else if (m.viewerCan.editOwn) {
              <a [routerLink]="['/members', m.id, 'edit']" class="btn-secondary"><svg lucidePencil class="size-4"></svg> {{ 'Edit my profile' | t }}</a>
            } @else if (m.viewerCan.propose) {
              <a [routerLink]="['/members', m.id, 'edit']" class="btn-secondary"><svg lucidePencil class="size-4"></svg> {{ 'Suggest a correction' | t }}</a>
            }
            @if (m.viewerCan.claim) {
              <button type="button" class="btn-secondary" (click)="claim(m)"><svg lucideHand class="size-4"></svg> {{ 'This is me' | t }}</button>
            }
            @if (context.can('member.merge')) {
              <a [routerLink]="['/members', m.id, 'merge']" class="btn-ghost" [title]="'Merge with another record' | t"><svg lucideGitMerge class="size-4"></svg><span class="sr-only sm:not-sr-only">{{ 'Merge' | t }}</span></a>
            }
            @if (m.viewerCan.viewHistory) {
              <a routerLink="/family/history" [queryParams]="{ targetId: m.id }" class="btn-ghost"><svg lucideHistory class="size-4"></svg><span class="sr-only sm:not-sr-only">{{ 'History' | t }}</span></a>
            }
            @if (!m.viewerCan.update) {
              <button type="button" class="btn-ghost" (click)="report(m)"><svg lucideShieldAlert class="size-4"></svg><span class="sr-only sm:not-sr-only">{{ 'Report' | t }}</span></button>
            }
            @if (!m.isFounder) {
              @if (m.viewerCan.delete) {
                <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="remove(m)"><svg lucideTrash2 class="size-4"></svg><span class="sr-only sm:not-sr-only">{{ 'Remove' | t }}</span></button>
              } @else if (m.viewerCan.propose) {
                <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="proposeRemoval(m)"><svg lucideFlag class="size-4"></svg><span class="sr-only sm:not-sr-only">{{ 'Propose removal' | t }}</span></button>
              }
            }
          </div>
        </div>
        @if (m.redacted) {
          <p class="mt-5 rounded-xl bg-stone-50 px-4 py-2 text-xs text-stone-500 dark:bg-stone-800/60">{{ 'Some details are private and are not shown to you.' | t }}</p>
        }
      </header>

      @if (notice(); as n) { <fh-alert [tone]="n.tone" class="mt-4">{{ n.text }}</fh-alert> }

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div class="space-y-6">
          <section class="card p-6" aria-labelledby="facts-h">
            <h2 id="facts-h" class="text-lg font-semibold">{{ 'Life' | t }}</h2>
            <dl class="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              @for (f of facts(); track f.label) {
                <div><dt class="text-xs font-medium uppercase tracking-wide text-stone-500">{{ f.label }}</dt><dd class="mt-0.5">{{ f.value }}</dd></div>
              } @empty {
                <p class="text-sm text-stone-500">{{ 'No details recorded yet.' | t }}</p>
              }
            </dl>
          </section>

          @if (lineageRows().length) {
            <section class="card p-6" aria-labelledby="lineage-h">
              <div class="flex items-baseline justify-between gap-2">
                <h2 id="lineage-h" class="text-lg font-semibold">{{ 'Lineage' | t }}</h2>
                <a routerLink="/lineage" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'All lines' | t }}</a>
              </div>
              <dl class="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
                @for (r of lineageRows(); track r.label) {
                  <div>
                    <dt class="text-xs font-medium uppercase tracking-wide text-stone-500">{{ r.label }}</dt>
                    <dd class="mt-0.5 font-medium">{{ r.value.name }}</dd>
                    <dd class="text-xs text-stone-500">
                      @if (r.value.source === 'own') { {{ 'Recorded on {name}' | t: { name: m.firstName } }} }
                      @else if (r.value.from) { {{ 'From' | t }} <a class="hover:underline" [routerLink]="['/members', r.value.from.id]">{{ r.value.from.displayName }}</a> }
                      @else { {{ 'Inherited' | t }} }
                    </dd>
                    @if (r.value.inheritedWouldBe) {
                      <dd class="mt-1 text-xs text-amber-800 dark:text-amber-300">{{ "Their parent's line is {line}" | t: { line: r.value.inheritedWouldBe } }}</dd>
                    }
                  </div>
                }
              </dl>
            </section>
          }

          @if (m.biography) {
            <section class="card p-6" aria-labelledby="bio-h">
              <h2 id="bio-h" class="text-lg font-semibold">{{ 'Biography' | t }}</h2>
              <p class="mt-3 whitespace-pre-line leading-relaxed text-stone-700 dark:text-stone-300">{{ m.biography }}</p>
            </section>
          }

          @if (m.occupations.length || m.education.length || m.achievements.length) {
            <section class="card grid gap-6 p-6 sm:grid-cols-2" [attr.aria-label]="'Work and education' | t">
              @if (m.occupations.length) {
                <div><h2 class="text-lg font-semibold">{{ 'Work' | t }}</h2><ul class="mt-2 list-disc space-y-1 pl-5 text-sm">@for (o of m.occupations; track $index) { <li>{{ o.title }}@if (o.organisation) { , {{ o.organisation }} }</li> }</ul></div>
              }
              @if (m.education.length) {
                <div><h2 class="text-lg font-semibold">{{ 'Education' | t }}</h2><ul class="mt-2 list-disc space-y-1 pl-5 text-sm">@for (e of m.education; track $index) { <li>{{ e.title }}</li> }</ul></div>
              }
              @if (m.achievements.length) {
                <div class="sm:col-span-2"><h2 class="text-lg font-semibold">{{ 'Achievements' | t }}</h2><ul class="mt-2 list-disc space-y-1 pl-5 text-sm">@for (a of m.achievements; track $index) { <li>{{ a }}</li> }</ul></div>
              }
            </section>
          }

          @if (m.sources.length) {
            <section class="card p-6" aria-labelledby="src-h">
              <h2 id="src-h" class="text-lg font-semibold">{{ 'Sources' | t }}</h2>
              <ul class="mt-2 space-y-2 text-sm">
                @for (s of m.sources; track $index) {
                  <li><span class="font-medium">{{ s.title }}</span>@if (s.citation) { — {{ s.citation }} }@if (s.url) { · <a [href]="s.url" target="_blank" rel="noopener noreferrer" class="text-brand-700 underline">{{ 'link' | t }}</a> }</li>
                }
              </ul>
            </section>
          }

          <section class="card p-6" aria-labelledby="media-h">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="media-h" class="text-lg font-semibold">{{ 'Photos & documents' | t }}</h2>
              <div class="flex gap-1">
                @if (uploads()) { <button type="button" class="btn-ghost !px-2 !py-1 text-sm" (click)="upload(m)"><svg lucideImagePlus class="size-4"></svg> {{ 'Add' | t }}</button> }
                @if (mediaTotal() > media().length) { <a routerLink="/media" [queryParams]="{ member: m.id }" class="btn-ghost !px-2 !py-1 text-sm">{{ 'All {count}' | t: { count: mediaTotal() } }}</a> }
              </div>
            </div>
            @if (media().length) {
              <fh-media-grid [items]="media()" [compact]="true" (open)="viewMedia($event)" />
            } @else {
              <p class="text-sm text-stone-500">{{ 'No photographs or documents of {name} yet.' | t: { name: m.firstName } }}</p>
            }
          </section>

          <section class="card p-6" aria-labelledby="stories-h">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="stories-h" class="text-lg font-semibold">{{ 'Stories' | t }}</h2>
              <div class="flex gap-1">
                <a routerLink="/history" [queryParams]="{ member: m.id }" class="btn-ghost !px-2 !py-1 text-sm"><svg lucideHistory class="size-4"></svg> {{ 'Timeline' | t }}</a>
                @if (canWriteStories()) { <a routerLink="/history/stories/new" [queryParams]="{ member: m.id }" class="btn-ghost !px-2 !py-1 text-sm"><svg lucideBookOpen class="size-4"></svg> {{ 'Write one' | t }}</a> }
              </div>
            </div>
            @if (stories().length) {
              <ul class="divide-y divide-stone-200 dark:divide-stone-800">
                @for (st of stories(); track st.id) {
                  <li class="py-2">
                    <a [routerLink]="['/history/stories', st.id]" class="font-medium hover:underline">{{ st.title }}</a>
                    <span class="ml-2 text-xs text-stone-500">{{ storyKinds[st.kind] | t }}@if (st.narrator) { · {{ 'told by {name}' | t: { name: st.narrator } }} }</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-sm text-stone-500">{{ 'No stories about {name} yet.' | t: { name: m.firstName } }}</p>
            }
          </section>

          @if (m.contact) {
            <section class="card p-6" aria-labelledby="contact-h">
              <h2 id="contact-h" class="text-lg font-semibold">{{ 'Contact' | t }} <span class="badge ml-1 bg-gold-100 text-gold-700">{{ 'Private' | t }}</span></h2>
              <dl class="mt-3 space-y-2 text-sm">
                @if (m.contact.email) { <div><dt class="inline text-stone-500">{{ 'E-mail:' | t }} </dt><dd class="inline">{{ m.contact.email }}</dd></div> }
                @if (m.contact.phone) { <div><dt class="inline text-stone-500">{{ 'Phone:' | t }} </dt><dd class="inline">{{ m.contact.phone }}</dd></div> }
                @if (m.contact.address) { <div><dt class="inline text-stone-500">{{ 'Address:' | t }} </dt><dd class="inline whitespace-pre-line">{{ m.contact.address }}</dd></div> }
              </dl>
            </section>
          }
        </div>

        <aside class="space-y-4" [attr.aria-label]="'Relatives' | t">
          @for (g of groups(); track g.key) {
            <section class="card p-5" [attr.aria-labelledby]="'rel-' + g.key">
              <div class="flex items-center justify-between gap-2">
                <h2 [id]="'rel-' + g.key" class="text-lg font-semibold">{{ g.title }}</h2>
                @if (g.kind && (m.viewerCan.manageRelationships || m.viewerCan.propose)) {
                  <div class="flex gap-1">
                    <button type="button" class="btn-ghost !px-2 !py-1 text-xs" (click)="link(m, g.kind)" [attr.aria-label]="g.linkLabel">
                      <svg lucidePlus class="size-3.5"></svg> {{ 'Existing' | t }}
                    </button>
                    @if (m.viewerCan.update || m.viewerCan.propose) {
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
                        <fh-person-avatar [name]="l.person.displayName" size="sm" />
                        <span class="min-w-0">
                          <span class="block truncate text-sm font-medium">{{ l.person.displayName }}</span>
                          <span class="block truncate text-xs text-stone-500">{{ describe(l) }}</span>
                        </span>
                      </a>
                      @if (isEdge(l) && (m.viewerCan.manageRelationships || m.viewerCan.propose)) {
                        <button type="button" class="btn-ghost !p-1.5" (click)="unlink(m, l)" [attr.aria-label]="(m.viewerCan.manageRelationships ? 'Remove link to {name}' : 'Propose removing the link to {name}') | t: { name: l.person.displayName }">
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
  private readonly collaboration = inject(CollaborationApi);
  private readonly archive = inject(ArchiveApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly member = signal<MemberView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  protected readonly span = lifespan;
  protected readonly storyKinds = STORY_KIND_LABELS;
  protected readonly media = signal<MediaView[]>([]);
  protected readonly mediaTotal = signal(0);
  protected readonly stories = signal<StoryView[]>([]);
  protected readonly uploads = computed(() => uploadMode(this.context));
  protected readonly photoBusy = signal(false);
  /** Editors, and people on their own claimed profile, who may add files. */
  protected readonly canChangePhoto = computed(() => {
    const m = this.member();
    return !!m && (m.viewerCan.update || m.viewerCan.editOwn) && this.uploads() !== null;
  });
  protected readonly canWriteStories = computed(() => {
    const f = this.context.active();
    return !!f && canPropose({ role: f.role }, 'story.create');
  });

  protected readonly facts = computed(() => {
    const m = this.member();
    if (!m) return [];
    const rows: { label: string; value: string }[] = [];
    const add = (label: string, value: string | null | undefined) => value && rows.push({ label, value });
    add(t('Born'), [formatFuzzyDate(m.birthDate), m.birthPlace].filter(Boolean).join(', '));
    add(t('Died'), [formatFuzzyDate(m.deathDate), m.deathPlace].filter(Boolean).join(', '));
    add(t('Hometown'), m.hometown);
    add(t('Nationality'), m.nationality);
    add(t('Maiden name'), m.maidenName);
    add(t('Also known as'), m.previousNames.join(', '));
    return rows;
  });

  protected readonly lineageRows = computed(() => {
    const m = this.member();
    if (!m?.lineage) return [];
    const labels = this.context.details()?.lineage ?? DEFAULT_LINEAGE_SETTINGS;
    return [
      { label: labels.maternal.label, value: m.lineage.maternal },
      { label: labels.paternal.label, value: m.lineage.paternal },
      { label: t('Totem'), value: m.lineage.totem },
    ].filter((r): r is { label: string; value: LineageValue } => !!r.value);
  });

  protected readonly groups = computed<RelativeGroup[]>(() => {
    const r = this.member()?.relatives;
    if (!r) return [];
    return [
      { key: 'parents', title: t('Parents'), linkLabel: t('Link an existing person as parents'), newLabel: t('Add a new person as parents'), kind: 'parent', newParam: 'parentOf', links: r.parents },
      { key: 'partners', title: t('Partners'), linkLabel: t('Link an existing person as partners'), newLabel: t('Add a new person as partners'), kind: 'partner', newParam: 'partnerOf', links: r.partners },
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
      void this.loadArchive(familyId, id);
    } catch (err) {
      const e = ApiError.from(err);
      this.error.set(e.code === 'NOT_FOUND' ? t('This person could not be found in the active family.') : e.message);
    }
  }

  private async loadArchive(familyId: string, id: string): Promise<void> {
    try {
      const [media, stories] = await Promise.all([this.archive.media(familyId, { memberId: id, pageSize: 8 }), this.archive.stories(familyId, { memberId: id, pageSize: 10 })]);
      this.media.set(media.data);
      this.mediaTotal.set(media.meta.total);
      this.stories.set(stories.data);
    } catch {
      // The archive is supplementary; the profile still shows.
    }
  }

  protected async upload(m: MemberView): Promise<void> {
    const ref = this.dialog.open<MediaView[], UploadDialogData>(UploadDialogComponent, { data: { familyId: m.familyId, people: [m], review: this.uploads() === 'review' } });
    const added = (await firstValueFrom(ref.closed)) ?? [];
    if (added.length) {
      this.notice.set({ tone: 'success', text: added.some((x) => x.status === 'pending_approval') ? t('Thank you — a moderator will review the files before the family sees them.') : t('Added to the archive.') });
      await this.loadArchive(m.familyId, m.id);
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
      if (media.status === 'pending_approval') {
        this.notice.set({ tone: 'info', text: t('The photo was sent to a moderator. It appears once they approve it.') });
      } else {
        this.notice.set({ tone: 'success', text: t("This is now {name}'s profile photo.", { name: m.displayName }) });
      }
      await this.load(m.familyId, m.id);
    } catch (err) {
      this.notice.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.photoBusy.set(false);
    }
  }

  protected async viewMedia(index: number): Promise<void> {
    const m = this.member()!;
    const ref = this.dialog.open<boolean, MediaViewerData>(MediaViewerComponent, { data: { familyId: m.familyId, items: this.media(), index } });
    if (await firstValueFrom(ref.closed)) await this.load(m.familyId, m.id);
  }

  protected isEdge(l: RelativeLink | SiblingLink): l is RelativeLink {
    return 'relationshipId' in l;
  }

  protected newParams(param: string, id: string): Record<string, string> {
    return { [param]: id };
  }

  protected describe(l: RelativeLink | SiblingLink): string {
    const life = lifespan(l.person);
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
      data: { familyId: m.familyId, person: { id: m.id, displayName: m.displayName }, kind, exclude, propose: !m.viewerCan.manageRelationships },
    });
    const result = await firstValueFrom(ref.closed);
    if (result === 'saved') {
      this.notice.set({ tone: 'success', text: t('Relationship saved.') });
      await this.load(m.familyId, m.id);
    } else if (result === 'proposed') {
      this.notice.set({ tone: 'success', text: t('Thank you — your suggestion has been sent to the moderators for review.') });
    }
  }

  private confirm(data: ConfirmData): Promise<boolean | undefined> {
    return firstValueFrom(this.dialog.open<boolean, ConfirmData>(ConfirmDialogComponent, { data, role: 'alertdialog' }).closed);
  }

  private prompt(data: PromptData): Promise<string | undefined> {
    return firstValueFrom(this.dialog.open<string, PromptData>(PromptDialogComponent, { data }).closed);
  }

  /** Submits a suggestion and reports the outcome on the page. */
  private async suggest(send: () => Promise<unknown>, text: string): Promise<void> {
    try {
      await send();
      this.notice.set({ tone: 'success', text });
    } catch (err) {
      this.notice.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }

  protected async report(m: MemberView): Promise<void> {
    const ref = this.dialog.open<boolean, ReportDialogData>(ReportDialogComponent, { data: { familyId: m.familyId, targetType: 'member', targetId: m.id, label: t('the profile of {name}', { name: m.displayName }) } });
    if (await firstValueFrom(ref.closed)) this.notice.set({ tone: 'success', text: t('Thank you. The platform team will review your report.') });
  }

  protected async claim(m: MemberView): Promise<void> {
    const evidence = await this.prompt({
      title: t('Is this you, {name}?', { name: m.firstName }),
      message: t('A family administrator checks the claim. Once approved, this profile is linked to your account and you can keep your own details up to date.'),
      label: t('Anything that helps them confirm it'),
      placeholder: t('e.g. my parents are listed here; ask Auntie Ama'),
      confirmLabel: t('Send claim'),
    });
    if (evidence === undefined) return;
    await this.suggest(() => this.collaboration.claim(m.familyId, m.id, evidence), t('Your claim has been sent. You will get an e-mail once it is reviewed.'));
    await this.load(m.familyId, m.id);
  }

  protected async proposeRemoval(m: MemberView): Promise<void> {
    const reason = await this.prompt({
      title: t('Propose removing {name}?', { name: m.displayName }),
      message: t('A moderator reviews the suggestion before anything is removed.'),
      label: t('Why should this profile be removed?'),
      placeholder: t('e.g. a duplicate of another profile'),
      confirmLabel: t('Send suggestion'),
      minLength: 3,
      danger: true,
    });
    if (reason === undefined) return;
    await this.suggest(
      () => this.collaboration.propose(m.familyId, { kind: 'member.delete', targetId: m.id, payload: { reason } }),
      t('Thank you — your suggestion has been sent to the moderators for review.'),
    );
  }

  protected async unlink(m: MemberView, l: RelativeLink): Promise<void> {
    if (!m.viewerCan.manageRelationships) {
      const reason = await this.prompt({
        title: t('Propose removing this link?'),
        message: t('A moderator reviews whether the link between {a} and {b} should be removed.', { a: m.displayName, b: l.person.displayName }),
        label: t('Why is the link wrong?'),
        confirmLabel: t('Send suggestion'),
        minLength: 3,
        danger: true,
      });
      if (reason === undefined) return;
      await this.suggest(
        () => this.collaboration.propose(m.familyId, { kind: 'relationship.delete', targetId: l.relationshipId, payload: { reason } }),
        t('Thank you — your suggestion has been sent to the moderators for review.'),
      );
      return;
    }
    const ok = await this.confirm({
      title: t('Remove this relationship?'),
      message: t('The link between {a} and {b} will be removed. Both people stay in the family. The change is recorded in the audit log.', { a: m.displayName, b: l.person.displayName }),
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
      message: t('Their profile and all their relationships will be removed from the family tree. The removal is recorded in the audit log.'),
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
