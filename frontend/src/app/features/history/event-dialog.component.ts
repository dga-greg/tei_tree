import { Dialog, DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideImagePlus, LucideMapPin, LucidePencil, LucideTrash2, LucideX } from '@lucide/angular';
import { ARCHIVE_PRIVACY, ARCHIVE_PRIVACY_LABELS, EVENT_KIND_LABELS, EVENT_KINDS, type ArchivePrivacy, type EventKind, type EventView, type MediaView, type PersonCard } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { paragraphs } from '../../shared/archive-format';
import { AlertComponent } from '../../shared/ui/alert.component';
import { fuzzyDateForm, fuzzyDateValue, FuzzyDateFieldComponent } from '../../shared/ui/fuzzy-date-field.component';
import { MediaGridComponent } from '../../shared/ui/media-grid.component';
import { PeopleFieldComponent } from '../../shared/ui/people-field.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { MediaViewerComponent, type MediaViewerData } from '../media/media-viewer.component';
import { uploadMode } from '../media/media.page';
import { UploadDialogComponent, type UploadDialogData } from '../media/upload-dialog.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface EventDialogData {
  familyId: string;
  /** Null to record a new event. */
  eventId: string | null;
}

/** Shows a family event with its photos; administrators and moderators record and edit events. Closes with a notice when something changed. */
@Component({
  selector: 'fh-event-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AlertComponent, SpinnerComponent, FuzzyDateFieldComponent, PeopleFieldComponent, PersonAvatarComponent, MediaGridComponent, LucideX, LucidePencil, LucideTrash2, LucideImagePlus, LucideMapPin, TranslatePipe],
  host: { class: 'block card max-h-[92dvh] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <div class="flex items-start gap-2">
      <h2 class="flex-1 text-xl font-semibold">{{ editing() ? (event() ? ('Edit event' | t) : ('Record an event' | t)) : event()?.title }}</h2>
      <button type="button" class="btn-ghost !p-2" (click)="close()" [attr.aria-label]="'Close' | t"><svg lucideX class="size-5"></svg></button>
    </div>
    @if (error(); as e) { <fh-alert class="mt-4">{{ e }}</fh-alert> }

    @if (editing()) {
      <form class="mt-5 space-y-5" [formGroup]="form" (submit)="$event.preventDefault(); save()">
        <div class="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <div>
            <label class="label" for="ev-kind">{{ 'Kind' | t }}</label>
            <select id="ev-kind" class="input" formControlName="kind">
              @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] | t }}</option> }
            </select>
          </div>
          <div>
            <label class="label" for="ev-title">{{ 'Title' | t }}</label>
            <input id="ev-title" class="input" formControlName="title" maxlength="200" [placeholder]="'e.g. The first family reunion in Kumasi' | t" />
          </div>
        </div>
        <fh-fuzzy-date-field [label]="'When' | t" [form]="date" />
        <div><label class="label" for="ev-place">{{ 'Where' | t }}</label><input id="ev-place" class="input" formControlName="place" maxlength="200" /></div>
        <div><label class="label" for="ev-desc">{{ 'What happened' | t }}</label><textarea id="ev-desc" class="input min-h-28" formControlName="description" maxlength="20000"></textarea></div>
        <fh-people-field [familyId]="data.familyId" [label]="'People involved' | t" [(value)]="people" />
        <div>
          <label class="label" for="ev-privacy">{{ 'Who can see it' | t }}</label>
          <select id="ev-privacy" class="input" formControlName="privacy">
            @for (p of privacyOptions; track p) { <option [value]="p">{{ privacyLabels[p] | t }}</option> }
          </select>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary" (click)="event() ? editing.set(false) : close()">{{ 'Cancel' | t }}</button>
          <button type="submit" class="btn-primary" [disabled]="busy() || form.invalid">{{ event() ? ('Save' | t) : ('Add to the timeline' | t) }}</button>
        </div>
      </form>
    } @else if (event(); as e) {
      <p class="mt-1 text-sm text-stone-500">{{ kindLabels[e.kind] | t }}@if (e.date) { · {{ fuzzy(e.date) }} }</p>
      @if (e.place) { <p class="mt-1 flex items-center gap-1 text-sm text-stone-600 dark:text-stone-300"><svg lucideMapPin class="size-3.5" aria-hidden="true"></svg>{{ e.place }}</p> }
      @for (p of paras(e.description); track $index) { <p class="mt-3 leading-relaxed text-stone-700 dark:text-stone-300">{{ p }}</p> }
      @if (e.people.length) {
        <ul class="mt-5 flex flex-wrap gap-2" [attr.aria-label]="'People involved' | t">
          @for (p of e.people; track p.id) {
            <li><a [routerLink]="['/members', p.id]" (click)="close()" class="flex items-center gap-2 rounded-full border border-stone-200 py-1 pl-1 pr-3 text-sm hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800"><fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" />{{ p.displayName }}</a></li>
          }
        </ul>
      }
      <section class="mt-6" aria-labelledby="ev-media-h">
        <div class="mb-3 flex items-center justify-between">
          <h3 id="ev-media-h" class="text-sm font-semibold uppercase tracking-wide text-stone-500">{{ 'Photos & files' | t }}</h3>
          @if (mode()) { <button type="button" class="btn-ghost !py-1 text-sm" (click)="upload(e)"><svg lucideImagePlus class="size-4"></svg> {{ 'Add' | t }}</button> }
        </div>
        @if (e.media.length) {
          <fh-media-grid [items]="e.media" [compact]="true" (open)="view(e.media, $event)" />
        } @else {
          <p class="text-sm text-stone-500">{{ 'None yet.' | t }}</p>
        }
      </section>
      @if (e.viewerCan.edit) {
        <div class="mt-6 flex flex-wrap gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
          <button type="button" class="btn-secondary" (click)="startEdit(e)"><svg lucidePencil class="size-4"></svg> {{ 'Edit' | t }}</button>
          @if (confirmDelete()) {
            <button type="button" class="btn-danger" (click)="remove(e)" [disabled]="busy()">{{ 'Remove the event' | t }}</button>
            <button type="button" class="btn-ghost" (click)="confirmDelete.set(false)">{{ 'Keep' | t }}</button>
          } @else {
            <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="confirmDelete.set(true)"><svg lucideTrash2 class="size-4"></svg> {{ 'Remove' | t }}</button>
          }
        </div>
      }
    } @else {
      <div class="mt-6"><fh-spinner /></div>
    }
  `,
})
export class EventDialogComponent {
  protected readonly data = inject<EventDialogData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<string>>(DialogRef);
  private readonly archive = inject(ArchiveApi);
  private readonly dialog = inject(Dialog);
  private readonly context = inject(FamilyContextStore);

  protected readonly kinds = EVENT_KINDS;
  protected readonly kindLabels = EVENT_KIND_LABELS;
  protected readonly privacyOptions = ARCHIVE_PRIVACY;
  protected readonly privacyLabels = ARCHIVE_PRIVACY_LABELS;
  protected readonly fuzzy = formatFuzzyDate;
  protected readonly paras = paragraphs;
  protected readonly mode = () => uploadMode(this.context);

  protected readonly event = signal<EventView | null>(null);
  protected readonly editing = signal(this.data.eventId === null);
  protected readonly busy = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly error = signal<string | null>(null);
  private changed: string | undefined;

  protected readonly form = inject(NonNullableFormBuilder).group({
    kind: ['reunion' as EventKind],
    title: ['', [Validators.required, Validators.maxLength(200)]],
    place: [''],
    description: [''],
    privacy: ['family' as ArchivePrivacy],
  });
  protected date = fuzzyDateForm();
  protected readonly people = signal<PersonCard[]>([]);

  constructor() {
    if (this.data.eventId) void this.load(this.data.eventId);
  }

  private async load(id: string): Promise<void> {
    try {
      this.event.set(await this.archive.event(this.data.familyId, id));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected startEdit(e: EventView): void {
    this.form.setValue({ kind: e.kind, title: e.title, place: e.place, description: e.description, privacy: e.privacy });
    this.date = fuzzyDateForm(e.date);
    this.people.set(e.people);
    this.editing.set(true);
  }

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    const body = { kind: v.kind, title: v.title.trim(), place: v.place.trim(), description: v.description.trim(), privacy: v.privacy, date: fuzzyDateValue(this.date), memberIds: this.people().map((p) => p.id) };
    this.busy.set(true);
    this.error.set(null);
    try {
      const current = this.event();
      const saved = current ? await this.archive.updateEvent(this.data.familyId, current.id, { ...body, version: current.version }) : await this.archive.createEvent(this.data.familyId, body);
      this.event.set(saved);
      this.editing.set(false);
      this.changed = current ? t('Event saved.') : t('“{title}” is on the timeline.', { title: saved.title });
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(e: EventView): Promise<void> {
    this.busy.set(true);
    try {
      await this.archive.removeEvent(this.data.familyId, e.id);
      this.ref.close(t('“{title}” was removed from the timeline.', { title: e.title }));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      this.busy.set(false);
    }
  }

  protected async upload(e: EventView): Promise<void> {
    const ref = this.dialog.open<MediaView[], UploadDialogData>(UploadDialogComponent, { data: { familyId: this.data.familyId, eventId: e.id, people: e.people, review: this.mode() === 'review' } });
    if ((await firstValueFrom(ref.closed))?.length) {
      await this.load(e.id);
      this.changed ??= t('Files added.');
    }
  }

  protected async view(items: MediaView[], index: number): Promise<void> {
    const ref = this.dialog.open<boolean, MediaViewerData>(MediaViewerComponent, { data: { familyId: this.data.familyId, items, index } });
    if (await firstValueFrom(ref.closed)) await this.load(this.event()!.id);
  }

  protected close(): void {
    this.ref.close(this.changed);
  }
}
