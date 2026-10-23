import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideX } from '@lucide/angular';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type FundContributionView, type FundView, type PaymentMethod, type PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamilyLifeApi } from '../../core/family-life/family-life.api';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { moneyInput, parseMoney, todayKey } from './money';

export interface ContributionDialogData {
  familyId: string;
  fund: FundView;
  contribution: FundContributionView | null;
}

/** Records (or corrects) money received for a fund. Closes with the saved contribution. */
@Component({
  selector: 'fh-contribution-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertComponent, PersonPickerComponent, LucideX, TranslatePipe],
  host: { class: 'block card max-h-[92dvh] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <div class="flex items-start gap-2">
      <h2 class="flex-1 text-xl font-semibold">{{ data.contribution ? ('Correct a contribution' | t) : ('Record a contribution' | t) }}</h2>
      <button type="button" class="btn-ghost !p-2" (click)="ref.close()" [attr.aria-label]="'Close' | t"><svg lucideX class="size-5"></svg></button>
    </div>
    <p class="mt-1 text-sm text-stone-500">{{ data.fund.name }}</p>
    @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }
    <form class="mt-5 space-y-4" [formGroup]="form" (submit)="$event.preventDefault(); save()">
      <fh-person-picker [familyId]="data.familyId" [label]="'From someone in the family tree' | t" [value]="person()" (picked)="person.set($event)" />
      <div>
        <label class="label" for="c-name">{{ 'Or from (name)' | t }}</label>
        <input id="c-name" class="input" formControlName="contributorName" maxlength="120" [placeholder]="namePlaceholder" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div><label class="label" for="c-amount">{{ 'Amount ({currency})' | t: { currency: data.fund.currency } }}</label><input id="c-amount" class="input" formControlName="amount" inputmode="decimal" [placeholder]="'e.g. 50' | t" /></div>
        <div><label class="label" for="c-date">{{ 'Date received' | t }}</label><input id="c-date" class="input" type="date" formControlName="date" /></div>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="c-method">{{ 'How' | t }}</label>
          <select id="c-method" class="input" formControlName="method">
            @for (m of methods; track m) { <option [value]="m">{{ methodLabels[m] | t }}</option> }
          </select>
        </div>
        <div><label class="label" for="c-ref">{{ 'Reference (optional)' | t }}</label><input id="c-ref" class="input" formControlName="reference" maxlength="120" [placeholder]="'e.g. transaction ID' | t" /></div>
      </div>
      <div><label class="label" for="c-note">{{ 'Note (optional)' | t }}</label><input id="c-note" class="input" formControlName="note" maxlength="1000" /></div>
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close()">{{ 'Cancel' | t }}</button>
        <button type="submit" class="btn-primary" [disabled]="busy() || form.invalid">{{ 'Save' | t }}</button>
      </div>
    </form>
  `,
})
export class ContributionDialogComponent {
  protected readonly data = inject<ContributionDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<FundContributionView>>(DialogRef);
  private readonly api = inject(FamilyLifeApi);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly namePlaceholder = t("e.g. Asante's church group");
  protected readonly methods = PAYMENT_METHODS;
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly person = signal<PersonCard | null>(this.data.contribution?.person ?? null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    contributorName: [this.data.contribution && !this.data.contribution.person ? this.data.contribution.contributorName : ''],
    amount: [moneyInput(this.data.contribution?.amount, this.data.fund.currency), Validators.required],
    date: [this.data.contribution?.date ?? todayKey(), Validators.required],
    method: this.fb.control<PaymentMethod>(this.data.contribution?.method ?? 'cash'),
    reference: [this.data.contribution?.reference ?? ''],
    note: [this.data.contribution?.note ?? ''],
  });

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    const amount = parseMoney(v.amount, this.data.fund.currency);
    if (!amount) return this.error.set(t('Enter the amount, e.g. 50 or 50.50.'));
    if (!this.person() && !v.contributorName.trim()) return this.error.set(t('Choose someone from the family tree, or enter who it is from.'));
    const body = { memberId: this.person()?.id ?? null, contributorName: this.person() ? '' : v.contributorName.trim(), amount, date: v.date, method: v.method, reference: v.reference.trim(), note: v.note.trim() };
    this.busy.set(true);
    this.error.set(null);
    try {
      const c = this.data.contribution;
      this.ref.close(c ? await this.api.updateContribution(this.data.familyId, this.data.fund.id, c.id, body) : await this.api.addContribution(this.data.familyId, this.data.fund.id, body));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
