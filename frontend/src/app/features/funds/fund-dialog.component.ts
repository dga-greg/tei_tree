import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideX } from '@lucide/angular';
import {
  COMMON_CURRENCIES,
  DUES_PERIODS,
  FUND_KIND_LABELS,
  FUND_KINDS,
  type DuesPeriod,
  type EventView,
  type FundInput,
  type FundKind,
  type FundView,
  type FundVisibility,
  type PersonCard,
} from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FamilyLifeApi } from '../../core/family-life/family-life.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { PeopleFieldComponent } from '../../shared/ui/people-field.component';
import { moneyInput, parseMoney } from './money';

export interface FundDialogData {
  familyId: string;
  fund: FundView | null;
}

const PERIOD_LABELS: Record<DuesPeriod, string> = { monthly: mark('every month'), yearly: mark('every year'), once: mark('once') };

/** Creates or edits a fund. Closes with the saved fund. */
@Component({
  selector: 'fh-fund-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertComponent, PeopleFieldComponent, LucideX, TranslatePipe],
  host: { class: 'block card max-h-[92dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <div class="flex items-start gap-2">
      <h2 class="flex-1 text-xl font-semibold">{{ data.fund ? ('Edit {name}' | t: { name: data.fund.name }) : ('New fund' | t) }}</h2>
      <button type="button" class="btn-ghost !p-2" (click)="ref.close()" [attr.aria-label]="'Close' | t"><svg lucideX class="size-5"></svg></button>
    </div>
    @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }
    <form class="mt-5 space-y-4" [formGroup]="form" (submit)="$event.preventDefault(); save()">
      <div class="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div><label class="label" for="f-name">{{ 'Name' | t }}</label><input id="f-name" class="input" formControlName="name" maxlength="120" [placeholder]="'e.g. Family welfare fund' | t" /></div>
        <div>
          <label class="label" for="f-kind">{{ 'Kind' | t }}</label>
          <select id="f-kind" class="input" formControlName="kind">
            @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] | t }}</option> }
          </select>
        </div>
      </div>
      <div><label class="label" for="f-purpose">{{ 'What it is for' | t }}</label><textarea id="f-purpose" class="input min-h-20" formControlName="purpose" maxlength="5000"></textarea></div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="f-currency">{{ 'Currency' | t }}</label>
          <input id="f-currency" class="input uppercase" formControlName="currency" list="currencies" maxlength="3" />
          <datalist id="currencies">@for (c of currencies; track c) { <option [value]="c"></option> }</datalist>
        </div>
        <div><label class="label" for="f-target">{{ 'Hoping to raise (optional)' | t }}</label><input id="f-target" class="input" formControlName="target" inputmode="decimal" [placeholder]="'e.g. 20000' | t" /></div>
      </div>
      @if (form.controls.kind.value === 'dues') {
        <fieldset class="space-y-3 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
          <legend class="px-1 text-sm font-semibold">{{ 'Dues' | t }}</legend>
          <div class="grid gap-4 sm:grid-cols-2">
            <div><label class="label" for="f-dues">{{ 'Amount each' | t }}</label><input id="f-dues" class="input" formControlName="duesAmount" inputmode="decimal" [placeholder]="'e.g. 50' | t" /></div>
            <div>
              <label class="label" for="f-period">{{ 'Paid' | t }}</label>
              <select id="f-period" class="input" formControlName="duesPeriod">
                @for (p of periods; track p) { <option [value]="p">{{ periodLabels[p] | t }}</option> }
              </select>
            </div>
          </div>
          <fh-people-field [familyId]="data.familyId" [label]="'Who pays dues' | t" [(value)]="payers" />
        </fieldset>
      }
      @if (ceremonies().length) {
        <div>
          <label class="label" for="f-ceremony">{{ 'For a ceremony' | t }}</label>
          <select id="f-ceremony" class="input" formControlName="ceremonyId">
            <option value="">{{ 'None' | t }}</option>
            @for (c of ceremonies(); track c.id) { <option [value]="c.id">{{ c.title }}</option> }
          </select>
        </div>
      }
      <fieldset>
        <legend class="label">{{ 'Who can see it' | t }}</legend>
        <label class="flex items-start gap-2 text-sm"><input type="radio" class="mt-1 accent-brand-700" formControlName="visibility" value="totals" /> {{ 'Members see the fund and its totals (and their own contributions)' | t }}</label>
        <label class="mt-1 flex items-start gap-2 text-sm"><input type="radio" class="mt-1 accent-brand-700" formControlName="visibility" value="members" /> {{ 'Members also see who gave what' | t }}</label>
        <label class="mt-1 flex items-start gap-2 text-sm"><input type="radio" class="mt-1 accent-brand-700" formControlName="visibility" value="admins" /> {{ 'Only administrators and treasurers' | t }}</label>
      </fieldset>
      @if (data.fund) {
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="accent-brand-700" formControlName="closed" /> {{ 'Closed (no more contributions)' | t }}</label>
      }
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close()">{{ 'Cancel' | t }}</button>
        <button type="submit" class="btn-primary" [disabled]="busy() || form.invalid">{{ data.fund ? ('Save' | t) : ('Create fund' | t) }}</button>
      </div>
    </form>
  `,
})
export class FundDialogComponent {
  protected readonly data = inject<FundDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<FundView>>(DialogRef);
  private readonly api = inject(FamilyLifeApi);
  private readonly archive = inject(ArchiveApi);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly kinds = FUND_KINDS;
  protected readonly kindLabels = FUND_KIND_LABELS;
  protected readonly periods = DUES_PERIODS;
  protected readonly periodLabels = PERIOD_LABELS;
  protected readonly currencies = COMMON_CURRENCIES;
  protected readonly ceremonies = signal<EventView[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected payers: PersonCard[];

  protected readonly form;

  constructor() {
    const f = this.data.fund;
    const currency = f?.currency ?? 'GHS';
    this.payers = f?.payers ?? [];
    this.form = this.fb.group({
      name: [f?.name ?? '', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
      kind: this.fb.control<FundKind>(f?.kind ?? 'dues'),
      purpose: [f?.purpose ?? ''],
      currency: [currency, [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
      target: [moneyInput(f?.target, currency)],
      duesAmount: [moneyInput(f?.dues?.amount, currency)],
      duesPeriod: this.fb.control<DuesPeriod>(f?.dues?.period ?? 'monthly'),
      ceremonyId: [f?.ceremony?.id ?? ''],
      visibility: this.fb.control<FundVisibility>(f?.visibility ?? 'totals'),
      closed: [f?.status === 'closed'],
    });
    void this.archive.events(this.data.familyId, { ceremonies: true }).then((c) => this.ceremonies.set(c), () => undefined);
  }

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    const currency = v.currency.toUpperCase();
    const target = v.target.trim() ? parseMoney(v.target, currency) : null;
    if (v.target.trim() && target === null) return this.error.set(t('Enter the target as an amount, e.g. 20000 or 20000.50.'));
    let dues: FundInput['dues'] = null;
    if (v.kind === 'dues') {
      const amount = parseMoney(v.duesAmount, currency);
      if (!amount) return this.error.set(t('Enter the dues amount, e.g. 50.'));
      dues = { amount, period: v.duesPeriod };
    }
    const body: FundInput = {
      name: v.name.trim(),
      kind: v.kind,
      purpose: v.purpose.trim(),
      currency,
      target,
      dues,
      payerIds: v.kind === 'dues' ? this.payers.map((p) => p.id) : [],
      visibility: v.visibility,
      ...(this.ceremonies().length ? { ceremonyId: v.ceremonyId || null } : {}),
      ...(this.data.fund ? { status: v.closed ? 'closed' : 'open' } : {}),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const f = this.data.fund;
      this.ref.close(f ? await this.api.updateFund(this.data.familyId, f.id, { ...body, version: f.version }) : await this.api.createFund(this.data.familyId, body));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
