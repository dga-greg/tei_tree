import { Dialog } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideMapPin, LucidePencil, LucideShieldAlert, LucideTrash2 } from '@lucide/angular';
import { ARCHIVE_PRIVACY_LABELS, STORY_KIND_LABELS, type MediaView, type StoryView } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { paragraphs } from '../../shared/archive-format';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ConfirmDialogComponent, type ConfirmData } from '../../shared/ui/confirm-dialog.component';
import { MediaGridComponent } from '../../shared/ui/media-grid.component';
import { ReportDialogComponent, type ReportDialogData } from '../../shared/ui/report-dialog.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { MediaViewerComponent, type MediaViewerData } from '../media/media-viewer.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-story-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, AlertComponent, SpinnerComponent, PersonAvatarComponent, MediaGridComponent, LucidePencil, LucideTrash2, LucideMapPin, LucideShieldAlert, TranslatePipe],
  template: `
    @if (error(); as e) {
      <fh-alert>{{ e }}</fh-alert>
      <a routerLink="/history" [queryParams]="{ tab: 'stories' }" class="btn-secondary mt-4">{{ 'Back to the stories' | t }}</a>
    } @else if (story(); as s) {
      <nav class="mb-4 text-sm" [attr.aria-label]="'Breadcrumb' | t">
        <a routerLink="/history" [queryParams]="{ tab: 'stories' }" class="text-brand-700 hover:underline dark:text-brand-300">{{ 'Stories & traditions' | t }}</a>
        <span class="mx-1.5 text-stone-400" aria-hidden="true">/</span>{{ s.title }}
      </nav>
      <article class="mx-auto max-w-3xl">
        <header class="mb-6">
          <p class="text-xs font-semibold uppercase tracking-wide text-gold-700">{{ kindLabels[s.kind] | t }}@if (s.date) { · {{ fuzzy(s.date) }} }</p>
          <h1 class="mt-2 font-serif text-4xl leading-tight font-semibold">{{ s.title }}</h1>
          <p class="mt-3 text-stone-600 dark:text-stone-300">
            @if (s.narrator) { {{ 'Told by' | t }} <strong>{{ s.narrator }}</strong> }
            @if (s.createdBy) { @if (s.narrator) { · } {{ 'Recorded by {name}, {date}' | t: { name: s.createdBy.displayName, date: (s.createdAt | date: 'longDate') } }} }
          </p>
          @if (s.place) { <p class="mt-1 flex items-center gap-1 text-sm text-stone-500"><svg lucideMapPin class="size-3.5" aria-hidden="true"></svg>{{ s.place }}</p> }
          @if (s.status !== 'published') {
            <fh-alert tone="info" class="mt-4 block">{{ s.status === 'pending_approval' ? ('This story is waiting for a moderator. Only you and the moderators can see it.' | t) : ('This story was not accepted. Only you can see it.' | t) }}</fh-alert>
          }
        </header>

        @if (s.recording; as r) {
          <section class="card mb-6 p-4" [attr.aria-label]="'Recording' | t">
            <p class="mb-2 text-sm font-medium">{{ 'Listen: {title}' | t: { title: r.title } }}</p>
            @if (r.kind === 'video') {
              <video controls preload="metadata" class="w-full rounded-lg" [src]="r.urls.original"></video>
            } @else {
              <audio controls preload="metadata" class="w-full" [src]="r.urls.original"></audio>
            }
          </section>
        }

        <div class="space-y-4 font-serif text-lg leading-relaxed text-stone-800 dark:text-stone-200">
          @for (p of paras(s.body); track $index) { <p class="whitespace-pre-line">{{ p }}</p> }
        </div>

        @if (s.people.length) {
          <section class="mt-8" aria-labelledby="st-people">
            <h2 id="st-people" class="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'People in this story' | t }}</h2>
            <ul class="flex flex-wrap gap-2">
              @for (p of s.people; track p.id) {
                <li><a [routerLink]="['/members', p.id]" class="flex items-center gap-2 rounded-full border border-stone-200 py-1 pl-1 pr-3 text-sm hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"><fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" />{{ p.displayName }}</a></li>
              }
            </ul>
          </section>
        }

        @if (s.media.length) {
          <section class="mt-8" aria-labelledby="st-media">
            <h2 id="st-media" class="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'Photos & documents' | t }}</h2>
            <fh-media-grid [items]="s.media" [compact]="true" (open)="view(s.media, $event)" />
          </section>
        }

        @if (s.sources.length) {
          <section class="mt-8" aria-labelledby="st-src">
            <h2 id="st-src" class="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'Sources' | t }}</h2>
            <ul class="list-disc space-y-1 pl-5 text-sm">
              @for (src of s.sources; track $index) { <li>{{ src.title }}@if (src.citation) { — {{ src.citation }} }</li> }
            </ul>
          </section>
        }

        @if (reported()) { <fh-alert tone="success" class="mt-8 block">{{ 'Thank you. The platform team will review your report.' | t }}</fh-alert> }
        <footer class="mt-10 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-5 text-sm text-stone-500 dark:border-stone-800">
          <span class="flex-1">{{ 'Visible to: {audience}' | t: { audience: (privacyLabels[s.privacy] | t) } }}</span>
          @if (s.viewerCan.edit) { <a [routerLink]="['/history/stories', s.id, 'edit']" class="btn-secondary"><svg lucidePencil class="size-4"></svg> {{ 'Edit' | t }}</a> }
          @else { <button type="button" class="btn-ghost" (click)="report(s)"><svg lucideShieldAlert class="size-4"></svg> {{ 'Report' | t }}</button> }
          @if (s.viewerCan.delete) { <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="remove(s)"><svg lucideTrash2 class="size-4"></svg> {{ 'Remove' | t }}</button> }
        </footer>
      </article>
    } @else {
      <fh-spinner [showLabel]="true" />
    }
  `,
})
export class StoryPage {
  readonly id = input.required<string>();
  private readonly context = inject(FamilyContextStore);
  private readonly archive = inject(ArchiveApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly story = signal<StoryView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly kindLabels = STORY_KIND_LABELS;
  protected readonly privacyLabels = ARCHIVE_PRIVACY_LABELS;
  protected readonly fuzzy = formatFuzzyDate;
  protected readonly paras = paragraphs;

  constructor() {
    effect(() => {
      const family = this.context.active();
      const id = this.id();
      if (family) untracked(() => void this.load(family.id, id));
    });
  }

  private async load(familyId: string, id: string): Promise<void> {
    try {
      this.story.set(await this.archive.story(familyId, id));
    } catch (err) {
      const e = ApiError.from(err);
      this.error.set(e.code === 'NOT_FOUND' ? t('This story could not be found.') : e.message);
    }
  }

  protected async view(items: MediaView[], index: number): Promise<void> {
    const ref = this.dialog.open<boolean, MediaViewerData>(MediaViewerComponent, { data: { familyId: this.context.active()!.id, items, index } });
    if (await firstValueFrom(ref.closed)) await this.load(this.context.active()!.id, this.id());
  }

  protected readonly reported = signal(false);

  protected async report(s: StoryView): Promise<void> {
    const ref = this.dialog.open<boolean, ReportDialogData>(ReportDialogComponent, { data: { familyId: this.context.active()!.id, targetType: 'story', targetId: s.id, label: `“${s.title}”` } });
    if (await firstValueFrom(ref.closed)) this.reported.set(true);
  }

  protected async remove(s: StoryView): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog.open<boolean, ConfirmData>(ConfirmDialogComponent, {
        data: {
          title: t('Remove “{title}”?', { title: s.title }),
          message: t('The story is removed for everyone. Attached photos stay in the archive. The removal is recorded in the change history.'),
          confirmLabel: t('Remove story'),
          danger: true,
        },
        role: 'alertdialog',
      }).closed,
    );
    if (!ok) return;
    try {
      await this.archive.removeStory(this.context.active()!.id, s.id);
      await this.router.navigate(['/history'], { queryParams: { tab: 'stories' } });
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }
}
