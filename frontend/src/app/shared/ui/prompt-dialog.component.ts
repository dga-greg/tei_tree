import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface PromptData {
  title: string;
  message: string;
  label: string;
  confirmLabel: string;
  placeholder?: string;
  /** Minimum length of the answer; 0 makes it optional. */
  minLength?: number;
  danger?: boolean;
}

/** Asks for a short piece of text (a reason, some evidence). Closes with the text, or undefined when cancelled. */
@Component({
  selector: 'fh-prompt-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block card w-[min(32rem,calc(100vw-2rem))] p-6 shadow-(--shadow-raised)' },
  template: `
    <h2 class="text-xl font-semibold">{{ data.title }}</h2>
    <p class="mt-3 text-sm text-stone-600 dark:text-stone-300">{{ data.message }}</p>
    <form class="mt-4" (submit)="$event.preventDefault(); submit()">
      <label class="label" for="prompt-text">{{ data.label }}@if (!min) { <span class="font-normal text-stone-500"> {{ '(optional)' | t }}</span> }</label>
      <textarea id="prompt-text" class="input min-h-24" maxlength="2000" [placeholder]="data.placeholder ?? ''" [value]="text()" (input)="text.set($any($event.target).value)" cdkFocusInitial></textarea>
      @if (min && text().trim().length < min) { <p class="mt-1 text-xs text-stone-500">{{ 'At least {min} characters.' | t: { min } }}</p> } <!-- i18n-ignore -->
      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close(undefined)">{{ 'Cancel' | t }}</button>
        <button type="submit" [class]="data.danger ? 'btn-danger' : 'btn-primary'" [disabled]="!valid()">{{ data.confirmLabel }}</button>
      </div>
    </form>
  `,
})
export class PromptDialogComponent {
  protected readonly data = inject<PromptData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<string>>(DialogRef);
  protected readonly min = this.data.minLength ?? 0;
  protected readonly text = signal('');
  protected readonly valid = computed(() => this.text().trim().length >= this.min);

  protected submit(): void {
    if (this.valid()) this.ref.close(this.text().trim());
  }
}
