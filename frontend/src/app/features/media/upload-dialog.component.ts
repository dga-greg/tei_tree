import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { LucideCircleCheck, LucideTriangleAlert, LucideUpload } from '@lucide/angular';
import { ARCHIVE_PRIVACY, ARCHIVE_PRIVACY_LABELS, type ArchivePrivacy, type MediaView, type PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { formatBytes, UPLOAD_ACCEPT } from '../../shared/archive-format';
import { AlertComponent } from '../../shared/ui/alert.component';
import { fuzzyDateForm, fuzzyDateValue, FuzzyDateFieldComponent } from '../../shared/ui/fuzzy-date-field.component';
import { PeopleFieldComponent } from '../../shared/ui/people-field.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface UploadDialogData {
  familyId: string;
  /** People already known to be in the files (e.g. uploading from a profile). */
  people?: PersonCard[];
  eventId?: string;
  /** The viewer's uploads are reviewed before they are published. */
  review: boolean;
}

interface Pending {
  file: File;
  progress: number | null;
  state: 'waiting' | 'uploading' | 'done' | 'failed';
  error?: string;
}

const MAX_FILES = 20;

/** Adds photos, documents and recordings to the family archive, with what is known about them. */
@Component({
  selector: 'fh-upload-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FuzzyDateFieldComponent, PeopleFieldComponent, AlertComponent, LucideUpload, LucideCircleCheck, LucideTriangleAlert, TranslatePipe],
  host: { class: 'block card max-h-[92dvh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <h2 class="text-xl font-semibold">{{ 'Add to the family archive' | t }}</h2>
    @if (data.review) {
      <p class="mt-1 text-sm text-stone-500">{{ 'A moderator looks at what you add before the rest of the family sees it.' | t }}</p>
    }

    <form class="mt-5 space-y-5" (submit)="$event.preventDefault(); start()">
      <div class="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition" [class]="dragging() ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-stone-300 dark:border-stone-700'" (dragover)="$event.preventDefault(); dragging.set(true)" (dragleave)="dragging.set(false)" (drop)="$event.preventDefault(); dragging.set(false); addFiles($any($event).dataTransfer?.files)">
        <svg lucideUpload class="size-7 text-stone-400" aria-hidden="true"></svg>
        <p class="text-sm">{{ 'Drop photos, PDFs or recordings here, or' | t }}</p>
        <label class="btn-secondary cursor-pointer">
          {{ 'Choose files' | t }}
          <input type="file" class="sr-only" multiple [accept]="accept" (change)="addFiles($any($event.target).files); $any($event.target).value = ''" [disabled]="busy()" />
        </label>
        <p class="text-xs text-stone-500">{{ 'JPEG, PNG, WebP, GIF, TIFF, PDF, MP3/M4A/WAV/OGG, MP4/WebM. Photos are stored without their location data.' | t }}</p>
      </div>

      @if (files().length) {
        <ul class="divide-y divide-stone-200 rounded-xl border border-stone-200 text-sm dark:divide-stone-800 dark:border-stone-800" [attr.aria-label]="'Files to upload' | t">
          @for (f of files(); track f.file) {
            <li class="flex items-center gap-3 px-3 py-2">
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ f.file.name }}</span>
                <span class="text-xs text-stone-500">{{ size(f.file.size) }}@if (f.error) { · <span class="text-red-700 dark:text-red-400">{{ f.error }}</span> }</span>
                @if (f.state === 'uploading') {
                  <span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" role="progressbar" [attr.aria-valuenow]="f.progress === null ? null : f.progress * 100" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Uploading {name}' | t: { name: f.file.name }">
                    <span class="block h-full rounded-full bg-brand-600" [class.animate-pulse]="f.progress === null" [style.width.%]="f.progress === null ? 100 : f.progress * 100"></span>
                  </span>
                }
              </span>
              @switch (f.state) {
                @case ('done') { <svg lucideCircleCheck class="size-5 text-brand-700" [attr.aria-label]="'Uploaded' | t"></svg> }
                @case ('failed') { <svg lucideTriangleAlert class="size-5 text-red-700" [attr.aria-label]="'Failed' | t"></svg> }
                @case ('waiting') { <button type="button" class="btn-ghost !px-2 !py-1 text-xs" (click)="removeFile(f)" [disabled]="busy()">{{ 'Remove' | t }}</button> }
              }
            </li>
          }
        </ul>
      }

      <div [formGroup]="form" class="space-y-5">
        @if (files().length <= 1) { <!-- i18n-ignore -->
          <div>
            <label class="label" for="up-title">{{ 'Title' | t }}</label>
            <input id="up-title" class="input" formControlName="title" maxlength="200" [placeholder]="'Taken from the file name if left empty' | t" />
          </div>
        }
        <div>
          <label class="label" for="up-desc">{{ 'Description' | t }}</label>
          <textarea id="up-desc" class="input min-h-20" formControlName="description" maxlength="5000" [placeholder]="'Who, where, what was happening…' | t"></textarea>
        </div>
        <fh-fuzzy-date-field [label]="'Date' | t" [form]="date" />
        <fh-people-field [familyId]="data.familyId" [label]="'People in it or mentioned' | t" [(value)]="people" />
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="up-source">{{ 'Where it comes from' | t }}</label>
            <input id="up-source" class="input" formControlName="source" maxlength="500" [placeholder]="sourcePlaceholder" />
          </div>
          <div>
            <label class="label" for="up-holder">{{ 'Who holds the original' | t }}</label>
            <input id="up-holder" class="input" formControlName="originalHolder" maxlength="200" />
          </div>
        </div>
        <div>
          <label class="label" for="up-privacy">{{ 'Who can see it' | t }}</label>
          <select id="up-privacy" class="input" formControlName="privacy">
            @for (p of privacyOptions; track p) { <option [value]="p">{{ privacyLabels[p] | t }}</option> }
          </select>
        </div>
        @if (data.review) {
          <div>
            <label class="label" for="up-note">{{ 'Note for the reviewer' | t }} <span class="font-normal text-stone-500">{{ '(optional)' | t }}</span></label>
            <input id="up-note" class="input" formControlName="note" maxlength="2000" />
          </div>
        }
      </div>

      @if (error(); as e) { <fh-alert>{{ e }}</fh-alert> }

      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="close()" [disabled]="busy()">{{ finished() ? ('Close' | t) : ('Cancel' | t) }}</button>
        @if (!finished()) {
          <button type="submit" class="btn-primary" [disabled]="!files().length || busy()">{{ busy() ? ('Uploading…' | t) : uploadLabel() }}</button>
        }
      </div>
    </form>
  `,
})
export class UploadDialogComponent {
  protected readonly data = inject<UploadDialogData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<MediaView[]>>(DialogRef);
  private readonly archive = inject(ArchiveApi);

  protected readonly accept = UPLOAD_ACCEPT;
  protected readonly size = formatBytes;
  protected readonly privacyOptions = ARCHIVE_PRIVACY;
  protected readonly privacyLabels = ARCHIVE_PRIVACY_LABELS;
  protected readonly sourcePlaceholder = t("e.g. Auntie Ama's album");
  protected readonly form = inject(NonNullableFormBuilder).group({
    title: [''],
    description: [''],
    source: [''],
    originalHolder: [''],
    privacy: ['family' as ArchivePrivacy],
    note: [''],
  });
  protected readonly date = fuzzyDateForm();
  protected readonly people = signal<PersonCard[]>(this.data.people ?? []);
  protected readonly files = signal<Pending[]>([]);
  protected readonly dragging = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly uploaded: MediaView[] = [];
  protected readonly finished = computed(() => this.files().length > 0 && this.files().every((f) => f.state === 'done'));
  protected readonly uploadLabel = computed(() => (this.files().length > 1 ? t('{count, plural, one {Upload # file} other {Upload # files}}', { count: this.files().length }) : t('Upload')));

  protected addFiles(list: FileList | null | undefined): void {
    if (!list) return;
    const next = [...this.files().filter((f) => f.state !== 'done'), ...[...list].map((file) => ({ file, progress: null, state: 'waiting' as const }))];
    if (next.length > MAX_FILES) this.error.set(t('Add at most {max} files at a time.', { max: MAX_FILES }));
    this.files.set(next.slice(0, MAX_FILES));
  }

  protected removeFile(f: Pending): void {
    this.files.set(this.files().filter((x) => x !== f));
  }

  private patch(f: Pending, change: Partial<Pending>): void {
    this.files.set(this.files().map((x) => (x.file === f.file ? { ...x, ...change } : x)));
  }

  protected async start(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    const single = this.files().length === 1;
    for (const f of this.files().filter((x) => x.state !== 'done')) {
      this.patch(f, { state: 'uploading', progress: null, error: undefined });
      try {
        const media = await this.archive.upload(
          this.data.familyId,
          f.file,
          {
            title: single ? v.title.trim() || undefined : undefined,
            description: v.description.trim() || undefined,
            date: fuzzyDateValue(this.date),
            memberIds: this.people().map((p) => p.id),
            eventId: this.data.eventId,
            privacy: v.privacy,
            provenance: v.source || v.originalHolder ? { source: v.source.trim(), originalHolder: v.originalHolder.trim() } : undefined,
            note: v.note.trim() || undefined,
          },
          (progress) => this.patch(f, { progress }),
        );
        this.uploaded.push(media);
        this.patch(f, { state: 'done', progress: 1 });
      } catch (err) {
        this.patch(f, { state: 'failed', error: ApiError.from(err).message });
      }
    }
    this.busy.set(false);
    if (this.finished()) this.ref.close(this.uploaded);
    else if (this.uploaded.length) this.error.set(t('Some files could not be added. The others are in the archive.'));
  }

  protected close(): void {
    this.ref.close(this.uploaded);
  }
}
