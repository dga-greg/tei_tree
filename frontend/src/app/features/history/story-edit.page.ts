import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideDynamicIcon, LucidePaperclip, LucideX } from '@lucide/angular';
import {
  ARCHIVE_PRIVACY,
  ARCHIVE_PRIVACY_LABELS,
  canPropose,
  STORY_KIND_LABELS,
  STORY_KINDS,
  type ArchivePrivacy,
  type MediaView,
  type PersonCard,
  type StoryKind,
  type StoryView,
} from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { MEDIA_ICONS } from '../../shared/archive-format';
import { AlertComponent } from '../../shared/ui/alert.component';
import { fuzzyDateForm, fuzzyDateValue, FuzzyDateFieldComponent } from '../../shared/ui/fuzzy-date-field.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PeopleFieldComponent } from '../../shared/ui/people-field.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { uploadMode } from '../media/media.page';
import { UploadDialogComponent, type UploadDialogData } from '../media/upload-dialog.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Write or edit a story, oral history, tradition or memory. */
@Component({
  selector: 'fh-story-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AlertComponent, SpinnerComponent, NoFamilyComponent, FuzzyDateFieldComponent, PeopleFieldComponent, LucideDynamicIcon, LucidePaperclip, LucideX, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (loadError(); as e) {
      <fh-alert>{{ e }}</fh-alert>
    } @else if (ready()) {
      <header class="mb-6 max-w-3xl">
        <h1 class="text-3xl font-semibold">{{ existing() ? ('Edit the story' | t) : ('Write a story' | t) }}</h1>
        @if (review()) {
          <fh-alert tone="info" class="mt-4 block">{{ 'A moderator reads new stories before the family sees them. You can keep editing yours afterwards.' | t }}</fh-alert>
        }
      </header>
      @if (error(); as e) { <fh-alert class="mb-4 max-w-3xl">{{ e }}</fh-alert> }

      <form class="max-w-3xl space-y-6" [formGroup]="form" (submit)="$event.preventDefault(); save()">
        <section class="card space-y-5 p-6">
          <div class="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <div>
              <label class="label" for="st-kind">{{ 'Kind' | t }}</label>
              <select id="st-kind" class="input" formControlName="kind">
                @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] | t }}</option> }
              </select>
            </div>
            <div>
              <label class="label" for="st-title">{{ 'Title' | t }}</label>
              <input id="st-title" class="input" formControlName="title" maxlength="200" [placeholder]="'e.g. How the family came to Kumasi' | t" [attr.aria-invalid]="form.controls.title.touched && form.controls.title.invalid" />
              @if (form.controls.title.touched && form.controls.title.invalid) { <p class="mt-1 text-xs text-red-700">{{ 'Give the story a title.' | t }}</p> }
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div><label class="label" for="st-narrator">{{ 'Told by' | t }}</label><input id="st-narrator" class="input" formControlName="narrator" maxlength="200" [placeholder]="'Who remembers or told it' | t" /></div>
            <div><label class="label" for="st-place">{{ 'Where' | t }}</label><input id="st-place" class="input" formControlName="place" maxlength="200" /></div>
          </div>
          <fh-fuzzy-date-field [label]="'When it happened or was recorded' | t" [form]="date" />
          <div>
            <label class="label" for="st-body">{{ form.controls.kind.value === 'oral_history' ? ('Transcript or summary' | t) : ('The story' | t) }}</label>
            <textarea id="st-body" class="input min-h-72 font-serif text-base leading-relaxed" formControlName="body" maxlength="100000" [placeholder]="'Leave a blank line between paragraphs.' | t"></textarea>
          </div>
          <fh-people-field [familyId]="context.active()!.id" [label]="'People in the story' | t" [(value)]="people" />
        </section>

        <section class="card space-y-4 p-6" aria-labelledby="st-files-h">
          <div class="flex items-center justify-between">
            <h2 id="st-files-h" class="font-semibold">{{ 'Recording, photos and documents' | t }}</h2>
            @if (mode()) { <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="attach()"><svg lucidePaperclip class="size-4"></svg> {{ 'Attach files' | t }}</button> }
          </div>
          @if (attached().length) {
            <ul class="divide-y divide-stone-200 rounded-xl border border-stone-200 text-sm dark:divide-stone-800 dark:border-stone-800">
              @for (m of attached(); track m.id) {
                <li class="flex items-center gap-3 px-3 py-2">
                  @if (m.urls.thumb) { <img [src]="m.urls.thumb" alt="" class="size-10 rounded object-cover" /> } @else { <svg [lucideIcon]="icons[m.kind]" class="size-6 text-stone-400" aria-hidden="true"></svg> }
                  <span class="min-w-0 flex-1 truncate">{{ m.title }}</span>
                  @if (m.kind === 'audio' || m.kind === 'video') {
                    <label class="flex items-center gap-1.5 text-xs"><input type="radio" name="recording" class="accent-brand-700" [checked]="recordingId() === m.id" (change)="recordingId.set(m.id)" /> {{ 'The recording' | t }}</label>
                  }
                  <button type="button" class="btn-ghost !p-1" (click)="detach(m)" [attr.aria-label]="'Detach {title}' | t: { title: m.title }"><svg lucideX class="size-4"></svg></button>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-stone-500">{{ 'For an oral history, attach the audio or video recording and mark it as the recording.' | t }}</p>
          }
        </section>

        <section class="card space-y-4 p-6">
          <div>
            <label class="label" for="st-privacy">{{ 'Who can read it' | t }}</label>
            <select id="st-privacy" class="input" formControlName="privacy">
              @for (p of privacyOptions; track p) { <option [value]="p">{{ privacyLabels[p] | t }}</option> }
            </select>
          </div>
          @if (review() && !existing()) {
            <div><label class="label" for="st-note">{{ 'Note for the reviewer' | t }} <span class="font-normal text-stone-500">{{ '(optional)' | t }}</span></label><input id="st-note" class="input" formControlName="note" maxlength="2000" /></div>
          }
        </section>

        <div class="flex gap-3">
          <button type="submit" class="btn-primary" [disabled]="busy()">{{ busy() ? ('Saving…' | t) : existing() ? ('Save changes' | t) : review() ? ('Send for review' | t) : ('Publish the story' | t) }}</button>
          <a [routerLink]="existing() ? ['/history/stories', existing()!.id] : ['/history']" [queryParams]="existing() ? {} : { tab: 'stories' }" class="btn-secondary">{{ 'Cancel' | t }}</a>
        </div>
      </form>
    } @else {
      <fh-spinner [showLabel]="true" />
    }
  `,
})
export class StoryEditPage {
  /** Route parameter when editing; query parameter `member` pre-fills a person when writing. */
  readonly id = input<string>();
  readonly member = input<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly archive = inject(ArchiveApi);
  private readonly membersApi = inject(MembersApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly kinds = STORY_KINDS;
  protected readonly kindLabels = STORY_KIND_LABELS;
  protected readonly privacyOptions = ARCHIVE_PRIVACY;
  protected readonly privacyLabels = ARCHIVE_PRIVACY_LABELS;
  protected readonly icons = MEDIA_ICONS;

  protected readonly form = inject(NonNullableFormBuilder).group({
    kind: ['story' as StoryKind],
    title: ['', [Validators.required, Validators.maxLength(200)]],
    narrator: [''],
    place: [''],
    body: [''],
    privacy: ['family' as ArchivePrivacy],
    note: [''],
  });
  protected date = fuzzyDateForm();
  protected readonly people = signal<PersonCard[]>([]);
  protected readonly attached = signal<MediaView[]>([]);
  protected readonly recordingId = signal<string | null>(null);
  protected readonly existing = signal<StoryView | null>(null);
  protected readonly ready = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly mode = computed(() => uploadMode(this.context));
  protected readonly review = computed(() => {
    const f = this.context.active();
    return !!f && !this.context.can('story.create') && canPropose({ role: f.role }, 'story.create');
  });

  constructor() {
    effect(() => {
      const family = this.context.active();
      const id = this.id();
      const memberId = this.member();
      if (family) untracked(() => void this.init(family.id, id, memberId));
    });
  }

  private async init(familyId: string, id: string | undefined, memberId: string | undefined): Promise<void> {
    try {
      if (id) {
        const s = await this.archive.story(familyId, id);
        if (!s.viewerCan.edit) {
          this.loadError.set(t('You cannot edit this story.'));
          return;
        }
        this.existing.set(s);
        this.form.patchValue({ kind: s.kind, title: s.title, narrator: s.narrator, place: s.place, body: s.body, privacy: s.privacy });
        this.date = fuzzyDateForm(s.date);
        this.people.set(s.people);
        this.attached.set([...(s.recording ? [s.recording] : []), ...s.media.filter((m) => m.id !== s.recording?.id)]);
        this.recordingId.set(s.recording?.id ?? null);
      } else if (memberId) {
        this.people.set([await this.membersApi.get(familyId, memberId)]);
      }
      this.ready.set(true);
    } catch (err) {
      this.loadError.set(ApiError.from(err).message);
    }
  }

  protected async attach(): Promise<void> {
    const ref = this.dialog.open<MediaView[], UploadDialogData>(UploadDialogComponent, { data: { familyId: this.context.active()!.id, people: this.people(), review: this.mode() === 'review' } });
    const added = (await firstValueFrom(ref.closed)) ?? [];
    this.attached.set([...this.attached(), ...added]);
    const recording = added.find((m) => m.kind === 'audio' || m.kind === 'video');
    if (recording && !this.recordingId()) this.recordingId.set(recording.id);
  }

  protected detach(m: MediaView): void {
    this.attached.set(this.attached().filter((x) => x.id !== m.id));
    if (this.recordingId() === m.id) this.recordingId.set(null);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const recordingMediaId = this.recordingId();
    const body = {
      kind: v.kind,
      title: v.title.trim(),
      narrator: v.narrator.trim(),
      place: v.place.trim(),
      body: v.body.trim(),
      privacy: v.privacy,
      date: fuzzyDateValue(this.date),
      memberIds: this.people().map((p) => p.id),
      mediaIds: this.attached().filter((m) => m.id !== recordingMediaId).map((m) => m.id),
      recordingMediaId,
    };
    if (!body.body && !recordingMediaId) {
      this.error.set(t('Write the story, or attach a recording and mark it as the recording.'));
      return;
    }
    const familyId = this.context.active()!.id;
    this.busy.set(true);
    this.error.set(null);
    try {
      const existing = this.existing();
      const saved = existing
        ? await this.archive.updateStory(familyId, existing.id, { ...body, version: existing.version })
        : await this.archive.createStory(familyId, { ...body, note: v.note.trim() || undefined });
      await this.router.navigate(['/history/stories', saved.id]);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      this.busy.set(false);
    }
  }
}
