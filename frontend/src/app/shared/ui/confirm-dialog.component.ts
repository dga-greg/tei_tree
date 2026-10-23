import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface ConfirmData {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}

@Component({
  selector: 'fh-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block card w-[min(28rem,calc(100vw-2rem))] p-6 shadow-(--shadow-raised)' },
  template: `
    <h2 class="text-xl font-semibold" id="confirm-title">{{ data.title }}</h2>
    <p class="mt-3 text-sm text-stone-600 dark:text-stone-300">{{ data.message }}</p>
    <div class="mt-6 flex justify-end gap-2">
      <button type="button" class="btn-secondary" (click)="ref.close(false)">{{ 'Cancel' | t }}</button>
      <button type="button" [class]="data.danger ? 'btn-danger' : 'btn-primary'" (click)="ref.close(true)" cdkFocusInitial>{{ data.confirmLabel }}</button>
    </div>
  `,
})
export class ConfirmDialogComponent {
  protected readonly data = inject<ConfirmData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}
