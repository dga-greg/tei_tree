import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideShieldAlert, LucideChevronLeft, LucideChevronRight, LucideCircleUser, LucideDownload, LucideDynamicIcon, LucidePencil, LucideScanFace, LucideTrash2, LucideX } from '@lucide/angular';
import { ARCHIVE_PRIVACY, ARCHIVE_PRIVACY_LABELS, MEDIA_KIND_LABELS, type ArchivePrivacy, type MediaView, type PersonCard, type PhotoBox, type PhotoTag } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { PublicConfigService } from '../../core/config/public-config.service';
import { MembersApi } from '../../core/members/members.api';
import { formatBytes, MEDIA_ICONS } from '../../shared/archive-format';
import { AlertComponent } from '../../shared/ui/alert.component';
import { fuzzyDateForm, fuzzyDateValue, FuzzyDateFieldComponent } from '../../shared/ui/fuzzy-date-field.component';
import { PeopleFieldComponent } from '../../shared/ui/people-field.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { ReportDialogComponent, type ReportDialogData } from '../../shared/ui/report-dialog.component';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { PhotoFrameComponent } from './photo-frame.component';
import { TranscriptPanelComponent } from './transcript-panel.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface MediaViewerData {
  familyId: string;
  items: MediaView[];
  index: number;
}

/** Closes with true when something changed, so the opener can refresh. */
@Component({
  selector: 'fh-media-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DatePipe,
    AlertComponent,
    FuzzyDateFieldComponent,
    PeopleFieldComponent,
    PersonAvatarComponent,
    PersonPickerComponent,
    PhotoFrameComponent,
    TranscriptPanelComponent,
    LucideDynamicIcon,
    LucideScanFace,
    LucideX,
    LucideChevronLeft,
    LucideChevronRight,
    LucideDownload,
    LucidePencil,
    LucideTrash2,
    LucideCircleUser,
    LucideShieldAlert,
    TranslatePipe,
  ],
  host: {
    class: 'flex h-[min(92dvh,56rem)] w-[min(78rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-(--shadow-raised) lg:flex-row dark:bg-stone-900',
    '(keydown.arrowleft)': 'go(-1)',
    '(keydown.arrowright)': 'go(1)',
  },
  template: `
    @let m = item();
    <section class="relative flex min-h-56 flex-1 items-center justify-center bg-stone-950" [attr.aria-label]="'Preview' | t">
      @switch (m.kind) {
        @case ('photo') {
          <fh-photo-frame class="p-2" [src]="m.urls.original" [alt]="m.title" [size]="{ width: m.width, height: m.height }" [tags]="m.tags" [showBoxes]="showBoxes()" [drawing]="tagging() && !busy()" [pending]="pendingBox()" [highlight]="highlight()" (drawn)="pendingBox.set($event)" />
        }
        @case ('audio') {
          <div class="w-full max-w-md p-6 text-center text-stone-200">
            <svg [lucideIcon]="icons.audio" class="mx-auto mb-4 size-14 opacity-70" aria-hidden="true"></svg>
            <audio controls preload="metadata" class="w-full" [src]="m.urls.original" [attr.aria-label]="'Play {title}' | t: { title: m.title }"></audio>
          </div>
        }
        @case ('video') {
          <video controls preload="metadata" class="max-h-full max-w-full" [src]="m.urls.original" [attr.aria-label]="m.title"></video>
        }
        @default {
          <div class="p-6 text-center text-stone-200">
            <svg [lucideIcon]="icons.document" class="mx-auto mb-4 size-16 opacity-70" aria-hidden="true"></svg>
            <p class="mb-4 text-sm opacity-80">{{ 'PDF document' | t }} · {{ bytes(m.byteSize) }}</p>
            <a class="btn-secondary" [href]="m.urls.original" target="_blank" rel="noopener">{{ 'Open the document' | t }}</a>
          </div>
        }
      }
      @if (m.kind === 'photo' && m.tags.length && !tagging()) {
        <button type="button" class="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white hover:bg-black/80" (click)="showBoxes.set(!showBoxes())" [attr.aria-pressed]="showBoxes()">
          {{ showBoxes() ? ('Hide names' | t) : ('Show who is who' | t) }}
        </button>
      }
      @if (data.items.length > 1 && !tagging()) {
        <button type="button" class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 disabled:opacity-30" (click)="go(-1)" [disabled]="index() === 0" [attr.aria-label]="'Previous' | t">
          <svg lucideChevronLeft class="size-5"></svg>
        </button>
        <button type="button" class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 disabled:opacity-30" (click)="go(1)" [disabled]="index() === data.items.length - 1" [attr.aria-label]="'Next' | t">
          <svg lucideChevronRight class="size-5"></svg>
        </button>
      }
    </section>

    <aside class="flex w-full flex-col overflow-y-auto border-t border-stone-200 lg:w-96 lg:border-l lg:border-t-0 dark:border-stone-800" [attr.aria-label]="'Details' | t">
      <div class="flex items-start gap-2 p-5 pb-0">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold uppercase tracking-wide text-stone-500">{{ kindLabels[m.kind] | t }}@if (m.status !== 'published') { · <span class="text-gold-700">{{ m.status === 'pending_approval' ? ('waiting for review' | t) : ('not accepted' | t) }}</span> }</p>
          <h2 class="mt-1 text-xl font-semibold break-words">{{ m.title }}</h2>
        </div>
        <button type="button" class="btn-ghost !p-2" (click)="close()" [attr.aria-label]="'Close' | t"><svg lucideX class="size-5"></svg></button>
      </div>

      @if (message(); as msg) { <fh-alert [tone]="msg.tone" class="mx-5 mt-4">{{ msg.text }}</fh-alert> }

      @if (tagging()) {
        <div class="space-y-4 p-5 text-sm">
          <p class="text-stone-600 dark:text-stone-300">{{ "Drag a box around someone's face in the photo, then choose who it is." | t }}</p>
          @if (pendingBox()) {
            <fh-person-picker [familyId]="data.familyId" [label]="'Who is this?' | t" [exclude]="taggedIds()" (picked)="addTag($event)" />
            <button type="button" class="btn-ghost !py-1 text-xs" (click)="pendingBox.set(null)">{{ 'Draw again' | t }}</button>
          }
          <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'Tagged ({count})' | t: { count: m.tags.length } }}</h3>
            @if (m.tags.length) {
              <ul class="space-y-1.5">
                @for (t of m.tags; track t.person!.id) {
                  <li class="flex items-center gap-2" (mouseenter)="highlight.set(t.person!.id)" (mouseleave)="highlight.set(null)">
                    <fh-person-avatar [name]="t.person!.displayName" [photoUrl]="t.person!.photoUrl" size="sm" />
                    <span class="flex-1 font-medium">{{ t.person!.displayName }}</span>
                    <button type="button" class="btn-ghost !px-2 !py-1 text-xs text-red-700 dark:text-red-400" (click)="removeTag(t)" [disabled]="busy()" [attr.aria-label]="'Remove the box around {name}' | t: { name: t.person!.displayName }">{{ 'Remove' | t }}</button>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-stone-500">{{ 'Nobody yet.' | t }}</p>
            }
          </div>
          <button type="button" class="btn-primary !py-1.5 text-sm" (click)="tagging.set(false); pendingBox.set(null)">{{ 'Done' | t }}</button>
        </div>
      } @else if (editing()) {
        <form class="space-y-4 p-5" [formGroup]="form" (submit)="$event.preventDefault(); save()">
          <div><label class="label" for="mv-title">{{ 'Title' | t }}</label><input id="mv-title" class="input" formControlName="title" maxlength="200" /></div>
          <div><label class="label" for="mv-desc">{{ 'Description' | t }}</label><textarea id="mv-desc" class="input min-h-20" formControlName="description" maxlength="5000"></textarea></div>
          <fh-fuzzy-date-field [label]="'Date' | t" [form]="date" />
          <fh-people-field [familyId]="data.familyId" [label]="'People' | t" [(value)]="people" />
          <div><label class="label" for="mv-src">{{ 'Where it comes from' | t }}</label><input id="mv-src" class="input" formControlName="source" maxlength="500" /></div>
          <div><label class="label" for="mv-holder">{{ 'Who holds the original' | t }}</label><input id="mv-holder" class="input" formControlName="originalHolder" maxlength="200" /></div>
          <div>
            <label class="label" for="mv-privacy">{{ 'Who can see it' | t }}</label>
            <select id="mv-privacy" class="input" formControlName="privacy">
              @for (p of privacyOptions; track p) { <option [value]="p">{{ privacyLabels[p] | t }}</option> }
            </select>
          </div>
          <div class="flex gap-2">
            <button type="submit" class="btn-primary" [disabled]="busy()">{{ 'Save' | t }}</button>
            <button type="button" class="btn-secondary" (click)="editing.set(false)">{{ 'Cancel' | t }}</button>
          </div>
        </form>
      } @else {
        <div class="space-y-5 p-5 text-sm">
          @if (m.description) { <p class="whitespace-pre-line text-stone-700 dark:text-stone-300">{{ m.description }}</p> }
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            @if (m.date) { <dt class="text-stone-500">{{ 'Date' | t }}</dt><dd>{{ fuzzy(m.date) }}</dd> }
            @if (m.provenance.source) { <dt class="text-stone-500">{{ 'Source' | t }}</dt><dd>{{ m.provenance.source }}</dd> }
            @if (m.provenance.originalHolder) { <dt class="text-stone-500">{{ 'Original held by' | t }}</dt><dd>{{ m.provenance.originalHolder }}</dd> }
            @if (m.uploadedBy) { <dt class="text-stone-500">{{ 'Added by' | t }}</dt><dd>{{ m.uploadedBy.displayName }}, {{ m.createdAt | date: 'mediumDate' }}</dd> }
            <dt class="text-stone-500">{{ 'Visible to' | t }}</dt><dd>{{ privacyLabels[m.privacy] | t }}</dd>
            <dt class="text-stone-500">{{ 'File' | t }}</dt><dd>{{ bytes(m.byteSize) }}@if (m.width) { · {{ m.width }} × {{ m.height }} }</dd>
          </dl>
          @if (m.people.length) {
            <div>
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'People' | t }}</h3>
              <ul class="space-y-1.5">
                @for (p of m.people; track p.id) {
                  <li class="flex items-center gap-2" (mouseenter)="highlight.set(p.id)" (mouseleave)="highlight.set(null)">
                    <fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" />
                    <a [routerLink]="['/members', p.id]" class="flex-1 font-medium hover:underline" (click)="close()">{{ p.displayName }}</a>
                    @if (m.viewerCan.setAsProfilePhoto) {
                      <button type="button" class="btn-ghost !px-2 !py-1 text-xs" (click)="setProfilePhoto(p)" [attr.aria-label]="'Use as profile photo of {name}' | t: { name: p.displayName }">
                        <svg lucideCircleUser class="size-3.5"></svg> {{ 'Profile photo' | t }}
                      </button>
                    }
                  </li>
                }
              </ul>
            </div>
          }
          @if (m.transcript) {
            <fh-transcript-panel [familyId]="data.familyId" [media]="m" [automatic]="transcription()" (changed)="replace($event)" />
          }
          <div class="flex flex-wrap gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
            <a class="btn-secondary !py-1.5 text-sm" [href]="m.urls.download"><svg lucideDownload class="size-4"></svg> {{ 'Download' | t }}</a>
            @if (m.viewerCan.edit) {
              <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="startEdit()"><svg lucidePencil class="size-4"></svg> {{ 'Edit' | t }}</button>
              @if (m.kind === 'photo') { <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="startTagging()"><svg lucideScanFace class="size-4"></svg> {{ 'Tag people' | t }}</button> }
            }
            @else { <button type="button" class="btn-ghost !py-1.5 text-sm" (click)="report()"><svg lucideShieldAlert class="size-4"></svg> {{ 'Report' | t }}</button> }
            @if (m.viewerCan.delete) {
              @if (confirmDelete()) {
                <button type="button" class="btn-danger !py-1.5 text-sm" (click)="remove()" [disabled]="busy()">{{ 'Remove for everyone' | t }}</button>
                <button type="button" class="btn-ghost !py-1.5 text-sm" (click)="confirmDelete.set(false)">{{ 'Keep' | t }}</button>
              } @else {
                <button type="button" class="btn-ghost !py-1.5 text-sm text-red-700 dark:text-red-400" (click)="confirmDelete.set(true)"><svg lucideTrash2 class="size-4"></svg> {{ 'Remove' | t }}</button>
              }
            }
          </div>
        </div>
      }
    </aside>
  `,
})
export class MediaViewerComponent {
  protected readonly data = inject<MediaViewerData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly archive = inject(ArchiveApi);
  private readonly members = inject(MembersApi);
  private readonly dialog = inject(Dialog);

  protected readonly items = signal(this.data.items);
  protected readonly index = signal(this.data.index);
  protected readonly item = computed(() => this.items()[this.index()]!);
  protected readonly editing = signal(false);
  protected readonly tagging = signal(false);
  protected readonly showBoxes = signal(true);
  protected readonly pendingBox = signal<PhotoBox | null>(null);
  protected readonly highlight = signal<string | null>(null);
  protected readonly taggedIds = computed(() => this.item().tags.map((tag) => tag.person!.id));
  protected readonly transcription = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  private changed = false;

  protected readonly icons = MEDIA_ICONS;
  protected readonly kindLabels = MEDIA_KIND_LABELS;
  protected readonly privacyOptions = ARCHIVE_PRIVACY;
  protected readonly privacyLabels = ARCHIVE_PRIVACY_LABELS;
  protected readonly bytes = formatBytes;
  protected readonly fuzzy = formatFuzzyDate;

  protected readonly form = inject(NonNullableFormBuilder).group({ title: [''], description: [''], source: [''], originalHolder: [''], privacy: ['family' as ArchivePrivacy] });
  protected date = fuzzyDateForm();
  protected readonly people = signal<PersonCard[]>([]);

  constructor() {
    void inject(PublicConfigService).get().then((c) => this.transcription.set(c.transcription));
  }

  protected go(step: number): void {
    const next = this.index() + step;
    if (next < 0 || next >= this.items().length || this.editing() || this.tagging()) return;
    this.index.set(next);
    this.message.set(null);
    this.confirmDelete.set(false);
  }

  protected startEdit(): void {
    const m = this.item();
    this.form.setValue({ title: m.title, description: m.description, source: m.provenance.source, originalHolder: m.provenance.originalHolder, privacy: m.privacy });
    this.date = fuzzyDateForm(m.date);
    this.people.set(m.people);
    this.editing.set(true);
  }

  protected startTagging(): void {
    this.message.set(null);
    this.showBoxes.set(true);
    this.pendingBox.set(null);
    this.tagging.set(true);
  }

  private async saveTags(tags: { memberId: string; box: PhotoBox }[], done: string): Promise<void> {
    this.busy.set(true);
    try {
      this.replace(await this.archive.setTags(this.data.familyId, this.item().id, this.item().version, tags));
      this.message.set({ tone: 'success', text: done });
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  private currentTags(): { memberId: string; box: PhotoBox }[] {
    return this.item().tags.map((tag) => ({ memberId: tag.person!.id, box: tag.box }));
  }

  protected async addTag(p: PersonCard | null): Promise<void> {
    const box = this.pendingBox();
    if (!p || !box) return;
    this.pendingBox.set(null);
    await this.saveTags([...this.currentTags().filter((x) => x.memberId !== p.id), { memberId: p.id, box }], t('{name} is tagged.', { name: p.displayName }));
  }

  protected async removeTag(tag: PhotoTag): Promise<void> {
    await this.saveTags(this.currentTags().filter((x) => x.memberId !== tag.person!.id), t('The box around {name} is removed.', { name: tag.person!.displayName }));
  }

  protected replace(m: MediaView): void {
    this.items.set(this.items().map((x) => (x.id === m.id ? m : x)));
    this.changed = true;
  }

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    this.busy.set(true);
    try {
      this.replace(
        await this.archive.updateMedia(this.data.familyId, this.item().id, {
          version: this.item().version,
          title: v.title.trim() || this.item().title,
          description: v.description.trim(),
          date: fuzzyDateValue(this.date),
          memberIds: this.people().map((p) => p.id),
          privacy: v.privacy,
          provenance: { source: v.source.trim(), originalHolder: v.originalHolder.trim() },
        }),
      );
      this.editing.set(false);
      this.message.set({ tone: 'success', text: t('Saved.') });
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    try {
      await this.archive.removeMedia(this.data.familyId, this.item().id);
      this.ref.close(true);
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
      this.busy.set(false);
    }
  }

  protected async setProfilePhoto(p: PersonCard): Promise<void> {
    try {
      const person = await this.members.get(this.data.familyId, p.id);
      await this.members.update(this.data.familyId, p.id, { version: person.version ?? 0, profilePhotoMediaId: this.item().id });
      this.changed = true;
      this.message.set({ tone: 'success', text: t("This is now {name}'s profile photo.", { name: p.displayName }) });
    } catch (err) {
      const e = ApiError.from(err);
      this.message.set({ tone: 'error', text: e.code === 'FORBIDDEN' ? t("You cannot change {name}'s profile. Suggest it as a correction instead.", { name: p.displayName }) : e.message });
    }
  }

  protected async report(): Promise<void> {
    const m = this.item();
    const ref = this.dialog.open<boolean, ReportDialogData>(ReportDialogComponent, { data: { familyId: this.data.familyId, targetType: 'media', targetId: m.id, label: `“${m.title}”` } });
    if (await firstValueFrom(ref.closed)) this.message.set({ tone: 'success', text: t('Thank you. The platform team will review your report.') });
  }

  protected close(): void {
    this.ref.close(this.changed);
  }
}
