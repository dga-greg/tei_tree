import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { LucideLanguages, LucidePencil, LucideSparkles } from '@lucide/angular';
import type { MediaView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

const POLL_MS = 4000;

/** What is said in a recording or video: typed by a relative, or transcribed by the speech service, with a translation. */
@Component({
  selector: 'fh-transcript-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, AlertComponent, SpinnerComponent, LucidePencil, LucideSparkles, LucideLanguages, TranslatePipe],
  template: `
    @let m = media();
    @let t = m.transcript!;
    <section aria-labelledby="tr-h" class="border-t border-stone-200 pt-4 dark:border-stone-800">
      <h3 id="tr-h" class="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'Transcript' | t }}</h3>
      @if (error(); as e) { <fh-alert class="mb-3 block">{{ e }}</fh-alert> }

      @if (editing()) {
        <form class="space-y-3" [formGroup]="form" (submit)="$event.preventDefault(); save()">
          <div>
            <label class="label" for="tr-lang">{{ 'Language spoken' | t }}</label>
            <input id="tr-lang" class="input" formControlName="language" maxlength="60" [placeholder]="'Twi, Ga, Ewe, English…' | t" />
          </div>
          <div>
            <label class="label" for="tr-text">{{ 'What is said' | t }}</label>
            <textarea id="tr-text" class="input min-h-40 font-[inherit]" formControlName="text" maxlength="200000"></textarea>
          </div>
          <div>
            <label class="label" for="tr-trl">{{ 'Translation' | t }} <span class="font-normal text-stone-500">{{ '(optional)' | t }}</span></label>
            <input id="tr-trl" class="input mb-2" formControlName="translationLanguage" maxlength="60" [placeholder]="'English' | t" [attr.aria-label]="'Language of the translation' | t" />
            <textarea id="tr-trl-text" class="input min-h-28" formControlName="translation" maxlength="200000" [attr.aria-label]="'Translation' | t"></textarea>
          </div>
          <div class="flex gap-2">
            <button type="submit" class="btn-primary !py-1.5 text-sm" [disabled]="busy()">{{ 'Save transcript' | t }}</button>
            <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="editing.set(false)">{{ 'Cancel' | t }}</button>
          </div>
        </form>
      } @else {
        @switch (t.status) {
          @case ('pending') {
            <p class="flex items-center gap-2 text-stone-600 dark:text-stone-300" role="status"><fh-spinner /> {{ 'Transcribing… this can take a few minutes. You can close this and come back.' | t }}</p>
          }
          @case ('failed') {
            <p class="text-red-700 dark:text-red-400" role="status">{{ t.error ? ('The transcription did not work: {error}.' | t: { error: t.error }) : ('The transcription did not work.' | t) }}</p>
          }
        }
        @if (t.text) {
          <p class="mb-1 text-xs text-stone-500">{{ t.language || ('Original' | t) }} · {{ t.source === 'automatic' ? ('transcribed automatically' | t) : ('typed by the family' | t) }}@if (t.updatedAt) { · {{ t.updatedAt | date: 'mediumDate' }} }</p>
          <div class="max-h-72 overflow-y-auto whitespace-pre-line rounded-lg bg-stone-50 p-3 leading-relaxed text-stone-800 dark:bg-stone-800/60 dark:text-stone-200" tabindex="0" [attr.aria-label]="'Transcript text' | t">{{ t.text }}</div>
          @if (t.translation; as tr) {
            <p class="mb-1 mt-3 flex items-center gap-1.5 text-xs text-stone-500"><svg lucideLanguages class="size-3.5" aria-hidden="true"></svg> {{ tr.language || ('Translation' | t) }}</p>
            <div class="max-h-72 overflow-y-auto whitespace-pre-line rounded-lg bg-stone-50 p-3 leading-relaxed text-stone-800 dark:bg-stone-800/60 dark:text-stone-200" tabindex="0" [attr.aria-label]="'Translation text' | t">{{ tr.text }}</div>
          }
        } @else if (t.status !== 'pending') {
          <p class="text-stone-500">{{ 'No transcript yet.' | t }}@if (m.viewerCan.edit) { {{ 'Type what is said so the family can read and search it.' | t }} }</p>
        }
        @if (m.viewerCan.edit && t.status !== 'pending') {
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="startEdit()"><svg lucidePencil class="size-4"></svg> {{ t.text ? ('Edit transcript' | t) : ('Type a transcript' | t) }}</button>
            @if (automatic() && !(t.source === 'typed' && t.text)) {
              <button type="button" class="btn-ghost !py-1.5 text-sm" (click)="transcribe(false)" [disabled]="busy()"><svg lucideSparkles class="size-4"></svg> {{ 'Transcribe automatically' | t }}</button>
              <button type="button" class="btn-ghost !py-1.5 text-sm" (click)="transcribe(true)" [disabled]="busy()"><svg lucideLanguages class="size-4"></svg> {{ '…and translate to English' | t }}</button>
            }
          </div>
        }
      }
    </section>
  `,
})
export class TranscriptPanelComponent {
  readonly familyId = input.required<string>();
  readonly media = input.required<MediaView>();
  /** Whether the server can transcribe automatically. */
  readonly automatic = input(false);
  readonly changed = output<MediaView>();

  private readonly archive = inject(ArchiveApi);
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(NonNullableFormBuilder).group({ language: [''], text: [''], translationLanguage: [t('English')], translation: [''] });
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // While the speech service works, check back now and then.
    effect(() => {
      const m = this.media();
      untracked(() => {
        this.stop();
        if (m.transcript?.status === 'pending') this.timer = setTimeout(() => void this.poll(m.id), POLL_MS);
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(id: string): Promise<void> {
    try {
      const fresh = await this.archive.mediaItem(this.familyId(), id);
      if (fresh.transcript?.status === 'pending') this.timer = setTimeout(() => void this.poll(id), POLL_MS);
      else if (this.media().id === id) this.changed.emit(fresh);
    } catch {
      this.timer = setTimeout(() => void this.poll(id), POLL_MS * 3);
    }
  }

  protected startEdit(): void {
    const tr = this.media().transcript!;
    this.form.setValue({ language: tr.language, text: tr.text, translationLanguage: tr.translation?.language || t('English'), translation: tr.translation?.text ?? '' });
    this.error.set(null);
    this.editing.set(true);
  }

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    this.busy.set(true);
    try {
      const m = await this.archive.setTranscript(this.familyId(), this.media().id, {
        version: this.media().version,
        text: v.text.trim(),
        language: v.language.trim(),
        translation: v.translation.trim() ? { text: v.translation.trim(), language: v.translationLanguage.trim() } : null,
      });
      this.editing.set(false);
      this.changed.emit(m);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async transcribe(translate: boolean): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.changed.emit(await this.archive.transcribe(this.familyId(), this.media().id, translate));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
