import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  PARENT_CHILD_SUBTYPE_LABELS,
  PARENT_CHILD_SUBTYPES,
  PARTNERSHIP_STATUS_LABELS,
  PARTNERSHIP_STATUSES,
  PARTNERSHIP_SUBTYPE_LABELS,
  PARTNERSHIP_SUBTYPES,
  type PersonCard,
  type VerificationState,
} from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { MembersApi } from '../../core/members/members.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { fuzzyDateForm, fuzzyDateValue, FuzzyDateFieldComponent } from '../../shared/ui/fuzzy-date-field.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export type RelationKind = 'parent' | 'child' | 'partner';

export interface RelationshipDialogData {
  familyId: string;
  person: { id: string; displayName: string };
  kind: RelationKind;
  /** Ids already linked, so they are not offered again. */
  exclude: string[];
}

export type RelationshipDialogResult = 'saved' | false;

/** Links an existing person as a parent, child or partner of the profile being viewed. */
@Component({
  selector: 'fh-relationship-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, PersonPickerComponent, FuzzyDateFieldComponent, AlertComponent, TranslatePipe],
  host: { class: 'block card max-h-[90dvh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <h2 class="text-xl font-semibold">{{ title }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()" class="mt-5 space-y-5" novalidate>
      @if (error(); as e) { <fh-alert>{{ e.message }}</fh-alert> }
      <fh-person-picker [familyId]="data.familyId" [label]="pickerLabel" [exclude]="data.exclude" (picked)="other.set($event)" />
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="rel-subtype">{{ 'Type' | t }}</label>
          <select id="rel-subtype" class="input" formControlName="subtype">
            @for (s of subtypes; track s.value) { <option [value]="s.value">{{ s.label | t }}</option> }
          </select>
        </div>
        @if (data.kind === 'partner') {
          <div>
            <label class="label" for="rel-status">{{ 'Status' | t }}</label>
            <select id="rel-status" class="input" formControlName="status">
              @for (s of statuses; track s) { <option [value]="s">{{ statusLabels[s] | t }}</option> }
            </select>
          </div>
        }
      </div>
      <fieldset>
        <legend class="label">{{ 'How certain is this?' | t }}</legend>
        <div class="flex flex-wrap gap-2">
          @for (v of verifications; track v.value) {
            <label class="flex cursor-pointer items-center rounded-xl border border-stone-300 px-3 py-2 text-sm has-checked:border-brand-600 has-checked:bg-brand-50 has-checked:text-brand-800 dark:border-stone-700 dark:has-checked:bg-brand-950 dark:has-checked:text-brand-100">
              <input type="radio" class="sr-only" formControlName="verification" [value]="v.value" />{{ v.label | t }}
            </label>
          }
        </div>
        <p class="mt-1.5 text-xs text-stone-500">{{ 'Only verified parent–child links count when generation numbers are calculated.' | t }}</p>
      </fieldset>
      @if (data.kind === 'partner') {
        <fh-fuzzy-date-field [label]="'Start (e.g. marriage)' | t" [form]="start" />
        <fh-fuzzy-date-field [label]="'End' | t" [form]="end" />
      }
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close(false)">{{ 'Cancel' | t }}</button>
        <button type="submit" class="btn-primary" [disabled]="!other() || busy()">{{ 'Save relationship' | t }}</button>
      </div>
    </form>
  `,
})
export class RelationshipDialogComponent {
  protected readonly data = inject<RelationshipDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<RelationshipDialogResult>>(DialogRef);
  private readonly membersApi = inject(MembersApi);

  protected readonly title = this.titleText();
  protected readonly pickerLabel = this.data.kind === 'parent' ? t('Parent') : this.data.kind === 'child' ? t('Child') : t('Husband or wife');
  protected readonly subtypes =
    this.data.kind === 'partner'
      ? PARTNERSHIP_SUBTYPES.map((s) => ({ value: s, label: PARTNERSHIP_SUBTYPE_LABELS[s] }))
      : PARENT_CHILD_SUBTYPES.map((s) => ({ value: s, label: PARENT_CHILD_SUBTYPE_LABELS[s] }));
  protected readonly statuses = PARTNERSHIP_STATUSES;
  protected readonly statusLabels = PARTNERSHIP_STATUS_LABELS;
  protected readonly verifications: { value: VerificationState; label: string }[] = [
    { value: 'verified', label: mark('Verified') },
    { value: 'unverified', label: mark('Not yet verified') },
    { value: 'disputed', label: mark('Disputed') },
  ];

  protected readonly form = inject(NonNullableFormBuilder).group({
    subtype: [this.data.kind === 'partner' ? 'marriage' : 'biological'],
    status: ['current'],
    verification: ['verified' as VerificationState],
  });
  protected readonly start = fuzzyDateForm();
  protected readonly end = fuzzyDateForm();
  protected readonly other = signal<PersonCard | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  private titleText(): string {
    const name = this.data.person.displayName;
    switch (this.data.kind) {
      case 'parent':
        return t('Add a parent of {name}', { name });
      case 'child':
        return t('Add a child of {name}', { name });
      default:
        return t('Add a husband or wife of {name}', { name });
    }
  }

  protected async save(): Promise<void> {
    const other = this.other();
    if (!other) return;
    const v = this.form.getRawValue();
    const self = this.data.person.id;
    this.busy.set(true);
    this.error.set(null);
    try {
      const body =
        this.data.kind === 'partner'
          ? {
              type: 'partnership' as const,
              personA: self,
              personB: other.id,
              subtype: v.subtype as never,
              status: v.status as never,
              verification: v.verification,
              startDate: fuzzyDateValue(this.start),
              endDate: fuzzyDateValue(this.end),
            }
          : {
              type: 'parent_child' as const,
              personA: this.data.kind === 'parent' ? other.id : self,
              personB: this.data.kind === 'parent' ? self : other.id,
              subtype: v.subtype as never,
              verification: v.verification,
            };
      await this.membersApi.addRelationship(this.data.familyId, body);
      this.ref.close('saved');
    } catch (err) {
      this.error.set(ApiError.from(err));
    } finally {
      this.busy.set(false);
    }
  }
}
