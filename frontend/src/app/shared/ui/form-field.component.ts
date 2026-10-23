import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import type { AbstractControl } from '@angular/forms';
import { t } from '../../core/i18n/i18n';

let nextId = 0;

/**
 * Label + control + hint + error message. The projected control must use `[attr.id]="field.controlId"`
 * and `[attr.aria-describedby]="field.describedBy()"` so assistive technology announces the error.
 */
@Component({
  selector: 'fh-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <label class="label" [attr.for]="controlId">{{ label() }}</label>
    <ng-content />
    @if (error(); as message) {
      <p class="mt-1.5 text-sm text-red-700 dark:text-red-400" [id]="errorId">{{ message }}</p>
    } @else if (hint()) {
      <p class="mt-1.5 text-xs text-stone-500" [id]="hintId">{{ hint() }}</p>
    }
  `,
})
export class FormFieldComponent {
  readonly label = input.required<string>();
  readonly control = input.required<AbstractControl>();
  readonly hint = input<string>();
  /** Server-side error for this field (from the API's `details`). */
  readonly serverError = input<string | undefined>();
  /** Messages keyed by validator name. */
  readonly messages = input<Record<string, string>>({});

  readonly controlId = `fh-field-${nextId++}`;
  readonly errorId = `${this.controlId}-error`;
  readonly hintId = `${this.controlId}-hint`;

  /** Bumped on every control event (value, status, touched…) so `error` recomputes. */
  private readonly version = signal(0);

  constructor() {
    effect((onCleanup) => {
      const sub = this.control().events.subscribe(() => this.version.update((v) => v + 1));
      onCleanup(() => sub.unsubscribe());
    });
  }

  readonly error = computed(() => {
    this.version();
    const c = this.control();
    const server = this.serverError();
    if (server) return server;
    if (!c.errors || !(c.touched || c.dirty)) return null;
    const key = Object.keys(c.errors)[0]!;
    const custom = this.messages()[key];
    if (custom) return custom;
    switch (key) {
      case 'required':
        return t('This field is required');
      case 'email':
        return t('Enter a valid e-mail address');
      case 'minlength':
        return t('Use at least {count} characters', { count: (c.errors['minlength'] as { requiredLength: number }).requiredLength });
      case 'maxlength':
        return t('Use at most {count} characters', { count: (c.errors['maxlength'] as { requiredLength: number }).requiredLength });
      default:
        return t('This value is not valid');
    }
  });

  readonly describedBy = computed(() => (this.error() ? this.errorId : this.hint() ? this.hintId : null));
}
