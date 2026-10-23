import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason, type ReportTarget } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { LifecycleApi } from '../../core/lifecycle/lifecycle.api';
import { AlertComponent } from './alert.component';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface ReportDialogData {
  familyId: string;
  targetType: ReportTarget;
  targetId?: string;
  /** What is being reported, for the heading. */
  label: string;
}

/** Reports content to the platform team. Closes with true once the report was sent. */
@Component({
  selector: 'fh-report-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AlertComponent, TranslatePipe],
  host: { class: 'block card max-h-[92dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <h2 class="text-xl font-semibold">{{ 'Report {label}' | t: { label: data.label } }}</h2>
    <p class="mt-1 text-sm text-stone-500">{{ "The platform team reviews reports. For mistakes in the family record, suggest a correction instead — the family's moderators handle those." | t }}</p>
    <form class="mt-5 space-y-4" (submit)="$event.preventDefault(); send()">
      <fieldset>
        <legend class="label">{{ 'What is wrong?' | t }}</legend>
        <div class="space-y-1.5">
          @for (r of reasons; track r) {
            <label class="flex items-start gap-2 text-sm"><input type="radio" name="reason" class="mt-1 accent-brand-700" [value]="r" [(ngModel)]="reason" /> {{ labels[r] | t }}</label>
          }
        </div>
      </fieldset>
      <div>
        <label class="label" for="rep-details">{{ 'Details' | t }}</label>
        <textarea id="rep-details" name="details" class="input min-h-24" maxlength="5000" [(ngModel)]="details" [placeholder]="'What should the team look at?' | t"></textarea>
        <p class="mt-1 text-xs text-stone-500">{{ 'At least 10 characters.' | t }}</p>
      </div>
      @if (error(); as e) { <fh-alert>{{ e }}</fh-alert> }
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close(false)">{{ 'Cancel' | t }}</button>
        <button type="submit" class="btn-primary" [disabled]="busy() || !reason || details.trim().length < 10">{{ 'Send report' | t }}</button>
      </div>
    </form>
  `,
})
export class ReportDialogComponent {
  protected readonly data = inject<ReportDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly api = inject(LifecycleApi);
  protected readonly reasons = REPORT_REASONS;
  protected readonly labels = REPORT_REASON_LABELS;
  protected reason: ReportReason | null = null;
  protected details = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async send(): Promise<void> {
    if (!this.reason) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.report({ familyId: this.data.familyId, targetType: this.data.targetType, targetId: this.data.targetId, reason: this.reason, details: this.details.trim() });
      this.ref.close(true);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
