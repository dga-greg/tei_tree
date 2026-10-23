import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'fh-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'alert',
    class: 'block rounded-xl border px-4 py-3 text-sm',
    '[class]': 'tones[tone()]',
  },
  template: `<ng-content />`,
})
export class AlertComponent {
  readonly tone = input<'error' | 'success' | 'info'>('error');
  protected readonly tones = {
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    success: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-100',
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200',
  };
}
