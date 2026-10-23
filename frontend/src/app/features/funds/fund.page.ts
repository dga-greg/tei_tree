import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideDownload, LucidePencil, LucidePlus, LucideTrash2 } from '@lucide/angular';
import { FUND_KIND_LABELS, PAYMENT_METHOD_LABELS, formatMoney, type FundContributionView, type FundReport, type FundView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { FamilyLifeApi } from '../../core/family-life/family-life.api';
import { currentLanguage, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ConfirmDialogComponent, type ConfirmData } from '../../shared/ui/confirm-dialog.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { ContributionDialogComponent, type ContributionDialogData } from './contribution-dialog.component';
import { FundDialogComponent, type FundDialogData } from './fund-dialog.component';
import { todayKey } from './money';

type Tab = 'contributions' | 'dues' | 'summary';

@Component({
  selector: 'fh-fund-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AlertComponent, PersonAvatarComponent, SpinnerComponent, LucideDownload, LucidePencil, LucidePlus, LucideTrash2, TranslatePipe],
  template: `
    <a routerLink="/funds" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">← {{ 'Family funds' | t }}</a>
    @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }
    @if (fund(); as f) {
      <header class="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-stone-500">{{ kindLabels[f.kind] | t }}@if (f.status === 'closed') { · {{ 'Closed' | t }} }</p>
          <h1 class="text-3xl font-semibold">{{ f.name }}</h1>
          @if (f.purpose) { <p class="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-300">{{ f.purpose }}</p> }
          @if (f.ceremony) { <p class="mt-1 text-sm">{{ 'For' | t }} <a class="font-medium text-brand-700 hover:underline dark:text-brand-300" [routerLink]="['/ceremonies', f.ceremony.id]">{{ f.ceremony.title }}</a></p> }
        </div>
        <div class="flex flex-wrap gap-2">
          @if (f.viewerCan.manage && f.status === 'open') { <button type="button" class="btn-primary" (click)="record()"><svg lucidePlus class="size-4"></svg> {{ 'Record a contribution' | t }}</button> }
          @if (f.viewerCan.seeContributions) { <a class="btn-secondary" [href]="api.exportUrl(familyId(), f.id)" download><svg lucideDownload class="size-4"></svg> CSV</a> } <!-- i18n-ignore -->
          @if (f.viewerCan.manage) {
            <button type="button" class="btn-secondary" (click)="edit(f)"><svg lucidePencil class="size-4"></svg> {{ 'Edit' | t }}</button>
            <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="remove(f)" [attr.aria-label]="'Remove fund' | t"><svg lucideTrash2 class="size-4"></svg></button>
          }
        </div>
      </header>

      <section class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4" [attr.aria-label]="'Totals' | t">
        <div class="card p-4"><p class="text-xs uppercase tracking-wide text-stone-500">{{ 'Raised' | t }}</p><p class="mt-1 text-2xl font-semibold tabular-nums">{{ money(f.totals.amount, f.currency) }}</p></div>
        <div class="card p-4"><p class="text-xs uppercase tracking-wide text-stone-500">{{ 'Contributions' | t }}</p><p class="mt-1 text-2xl font-semibold">{{ f.totals.count }}</p></div>
        <div class="card p-4"><p class="text-xs uppercase tracking-wide text-stone-500">{{ 'Contributors' | t }}</p><p class="mt-1 text-2xl font-semibold">{{ f.totals.contributors }}</p></div>
        <div class="card p-4"><p class="text-xs uppercase tracking-wide text-stone-500">{{ f.target ? ('Target' | t) : ('Dues' | t) }}</p><p class="mt-1 text-2xl font-semibold tabular-nums">{{ f.target ? money(f.target, f.currency) : f.dues ? money(f.dues.amount, f.currency) : '—' }}</p>
          @if (f.target) { <p class="text-xs text-stone-500">{{ '{percent}% raised' | t: { percent: percent(f) } }}</p> }</div>
      </section>

      <div role="tablist" [attr.aria-label]="'Fund' | t" class="mt-6 inline-flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
        @for (t of tabs(); track t.id) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.id" class="rounded-lg px-4 py-1.5 text-sm font-medium" [class]="tab() === t.id ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-600 dark:text-stone-300'" (click)="tab.set(t.id)">{{ t.label }}</button>
        }
      </div>

      @switch (tab()) {
        @case ('contributions') {
          @if (!f.viewerCan.seeContributions) { <p class="mt-3 text-sm text-stone-500">{{ "The family shares this fund's totals; below are your own contributions." | t }}</p> }
          @if (contributions() === null) {
            <fh-spinner class="mt-4" />
          } @else if (!contributions()!.length) {
            <p class="mt-4 text-sm text-stone-500">{{ f.viewerCan.seeContributions ? ('No contributions yet.' | t) : ('No contributions from you yet.' | t) }}</p>
          } @else {
            <div class="card mt-4 overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900">
                  <tr><th scope="col" class="px-4 py-2">{{ 'Date' | t }}</th><th scope="col" class="px-4 py-2">{{ 'From' | t }}</th><th scope="col" class="px-4 py-2 text-right">{{ 'Amount' | t }}</th><th scope="col" class="px-4 py-2">{{ 'How' | t }}</th>
                    @if (f.viewerCan.manage) { <th scope="col" class="px-4 py-2">{{ 'Reference' | t }}</th><th scope="col" class="px-4 py-2"><span class="sr-only">{{ 'Actions' | t }}</span></th> }</tr>
                </thead>
                <tbody class="divide-y divide-stone-200 dark:divide-stone-800">
                  @for (c of contributions(); track c.id) {
                    <tr>
                      <td class="whitespace-nowrap px-4 py-2">{{ c.date }}</td>
                      <td class="px-4 py-2">
                        @if (c.person) { <a [routerLink]="['/members', c.person.id]" class="flex items-center gap-2 hover:underline"><fh-person-avatar [name]="c.person.displayName" [photoUrl]="c.person.photoUrl" size="sm" />{{ c.person.displayName }}</a> }
                        @else { {{ c.contributorName }} }
                        @if (c.note) { <span class="block text-xs text-stone-500">{{ c.note }}</span> }
                      </td>
                      <td class="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">{{ money(c.amount, f.currency) }}</td>
                      <td class="px-4 py-2">{{ methodLabels[c.method] | t }}</td>
                      @if (f.viewerCan.manage) {
                        <td class="px-4 py-2 text-stone-500">{{ c.reference }}</td>
                        <td class="whitespace-nowrap px-4 py-2 text-right">
                          <button type="button" class="btn-ghost !p-1.5" (click)="record(c)" [attr.aria-label]="'Correct the contribution of {date}' | t: { date: c.date }"><svg lucidePencil class="size-4"></svg></button>
                          <button type="button" class="btn-ghost !p-1.5 text-red-700 dark:text-red-400" (click)="removeContribution(c)" [attr.aria-label]="'Remove the contribution of {date}' | t: { date: c.date }"><svg lucideTrash2 class="size-4"></svg></button>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
        @case ('dues') {
          @if (report(); as r) {
            @if (r.dues; as d) {
              <div class="mt-4 flex flex-wrap items-end gap-3">
                @if (f.dues?.period !== 'once') {
                  <div>
                    <label class="label" for="period">{{ f.dues?.period === 'monthly' ? ('Month' | t) : ('Year' | t) }}</label>
                    <input id="period" class="input" [type]="f.dues?.period === 'monthly' ? 'month' : 'number'" [ngModel]="d.period" (ngModelChange)="setPeriod($event)" />
                  </div>
                }
                <p class="pb-2 text-sm">{{ 'Paid {paid} of {due} due.' | t: { paid: money(d.totals.paid, f.currency), due: money(d.totals.due, f.currency) } }}</p>
              </div>
              <div class="card mt-3 overflow-x-auto">
                <table class="w-full text-sm">
                  <thead class="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900"><tr><th scope="col" class="px-4 py-2">{{ 'Person' | t }}</th><th scope="col" class="px-4 py-2 text-right">{{ 'Due' | t }}</th><th scope="col" class="px-4 py-2 text-right">{{ 'Paid' | t }}</th><th scope="col" class="px-4 py-2 text-right">{{ 'Still owing' | t }}</th></tr></thead>
                  <tbody class="divide-y divide-stone-200 dark:divide-stone-800">
                    @for (row of d.rows; track row.person.id) {
                      <tr>
                        <td class="px-4 py-2"><a [routerLink]="['/members', row.person.id]" class="hover:underline">{{ row.person.displayName }}</a></td>
                        <td class="px-4 py-2 text-right tabular-nums">{{ money(row.due, f.currency) }}</td>
                        <td class="px-4 py-2 text-right tabular-nums">{{ money(row.paid, f.currency) }}</td>
                        <td class="px-4 py-2 text-right font-medium tabular-nums" [class.text-red-700]="row.balance > 0" [class.dark:text-red-400]="row.balance > 0">{{ row.balance ? money(row.balance, f.currency) : ('Paid' | t) }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="4" class="px-4 py-3 text-stone-500">{{ "Choose who pays dues in the fund's settings." | t }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          } @else { <fh-spinner class="mt-4" /> }
        }
        @case ('summary') {
          @if (report(); as r) {
            <div class="mt-4 grid gap-6 lg:grid-cols-2">
              <section class="card p-5" aria-labelledby="branch-h">
                <h2 id="branch-h" class="font-semibold">{{ 'By branch' | t }}</h2>
                <p class="mt-1 text-xs text-stone-500">{{ 'Someone in two branches counts in both.' | t }}</p>
                <ul class="mt-3 space-y-2">
                  @for (b of r.byBranch; track b.branch?.id ?? 'none') {
                    <li>
                      <div class="flex justify-between gap-2 text-sm"><span>{{ b.branch?.name ?? ('Not in a branch' | t) }}</span><span class="font-medium tabular-nums">{{ money(b.amount, f.currency) }}</span></div>
                      <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"><div class="h-full rounded-full bg-brand-600" [style.width.%]="share(b.amount, f)"></div></div>
                    </li>
                  } @empty { <li class="text-sm text-stone-500">{{ 'Nothing yet.' | t }}</li> }
                </ul>
              </section>
              <section class="card p-5" aria-labelledby="month-h">
                <h2 id="month-h" class="font-semibold">{{ 'By month' | t }}</h2>
                <ul class="mt-3 space-y-2">
                  @for (m of r.byMonth; track m.month) {
                    <li class="flex justify-between gap-2 text-sm"><span>{{ monthLabel(m.month) }}</span><span class="font-medium tabular-nums">{{ money(m.amount, f.currency) }}</span></li>
                  } @empty { <li class="text-sm text-stone-500">{{ 'Nothing yet.' | t }}</li> }
                </ul>
              </section>
            </div>
          } @else { <fh-spinner class="mt-4" /> }
        }
      }
    } @else if (!error()) {
      <fh-spinner class="mt-6" [showLabel]="true" />
    }
  `,
})
export class FundPage {
  readonly id = input.required<string>();
  protected readonly context = inject(FamilyContextStore);
  protected readonly api = inject(FamilyLifeApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly fund = signal<FundView | null>(null);
  protected readonly contributions = signal<FundContributionView[] | null>(null);
  protected readonly report = signal<FundReport | null>(null);
  protected readonly period = signal<string | undefined>(undefined);
  protected readonly tab = signal<Tab>('contributions');
  protected readonly error = signal<string | null>(null);
  protected readonly kindLabels = FUND_KIND_LABELS;
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly money = formatMoney;

  protected readonly tabs = computed(() => {
    const f = this.fund();
    const tabs: { id: Tab; label: string }[] = [{ id: 'contributions', label: f?.viewerCan.seeContributions ? t('Contributions') : t('Your contributions') }];
    if (f?.viewerCan.seeContributions && f.dues) tabs.push({ id: 'dues', label: t('Dues') });
    if (f?.viewerCan.seeContributions) tabs.push({ id: 'summary', label: t('By branch and month') });
    return tabs;
  });

  protected familyId(): string {
    return this.context.active()?.id ?? '';
  }

  constructor() {
    effect(() => {
      const family = this.context.active();
      const id = this.id();
      if (family) untracked(() => void this.load(family.id, id));
    });
    effect(() => {
      const f = this.fund();
      const tab = this.tab();
      const period = this.period();
      if (f && f.viewerCan.seeContributions && tab !== 'contributions') untracked(() => void this.loadReport(f.id, period));
    });
  }

  private async load(familyId: string, id: string): Promise<void> {
    try {
      const [fund, contributions] = await Promise.all([this.api.fund(familyId, id), this.api.contributions(familyId, id)]);
      this.fund.set(fund);
      this.contributions.set(contributions);
      this.report.set(null);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  private async loadReport(fundId: string, period?: string): Promise<void> {
    try {
      this.report.set(await this.api.report(this.familyId(), fundId, period));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected setPeriod(value: string | number): void {
    const v = String(value);
    if (/^\d{4}(-\d{2})?$/.test(v)) this.period.set(v);
  }

  protected percent(f: FundView): number {
    return f.target ? Math.min(100, Math.round((f.totals.amount / f.target) * 100)) : 0;
  }
  protected share(amount: number, f: FundView): number {
    return f.totals.amount ? Math.round((amount / f.totals.amount) * 100) : 0;
  }
  protected monthLabel(month: string): string {
    return new Date(`${month}-01T12:00:00`).toLocaleDateString(currentLanguage().formats, { month: 'long', year: 'numeric' });
  }

  protected async record(contribution: FundContributionView | null = null): Promise<void> {
    const f = this.fund()!;
    const ref = this.dialog.open<FundContributionView, ContributionDialogData>(ContributionDialogComponent, { data: { familyId: this.familyId(), fund: f, contribution } });
    if (await firstValueFrom(ref.closed)) await this.load(this.familyId(), f.id);
  }

  protected async removeContribution(c: FundContributionView): Promise<void> {
    const f = this.fund()!;
    const ok = await firstValueFrom(
      this.dialog.open<boolean, ConfirmData>(ConfirmDialogComponent, {
        data: {
          title: t('Remove this contribution?'),
          message: t('{amount} from {name} on {date}. The removal is recorded in the change history.', { amount: this.money(c.amount, f.currency), name: c.contributorName, date: c.date }),
          confirmLabel: t('Remove'),
          danger: true,
        },
        role: 'alertdialog',
      }).closed,
    );
    if (!ok) return;
    try {
      await this.api.removeContribution(this.familyId(), f.id, c.id);
      await this.load(this.familyId(), f.id);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected async edit(f: FundView): Promise<void> {
    const ref = this.dialog.open<FundView, FundDialogData>(FundDialogComponent, { data: { familyId: this.familyId(), fund: f } });
    if (await firstValueFrom(ref.closed)) await this.load(this.familyId(), f.id);
  }

  protected async remove(f: FundView): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog.open<boolean, ConfirmData>(ConfirmDialogComponent, {
        data: {
          title: t('Remove {name}?', { name: f.name }),
          message: t('The fund and its contributions are removed from view. The removal is recorded in the change history. Download the CSV first if you need the records.'),
          confirmLabel: t('Remove fund'),
          danger: true,
        },
        role: 'alertdialog',
      }).closed,
    );
    if (!ok) return;
    try {
      await this.api.removeFund(this.familyId(), f.id);
      await this.router.navigate(['/funds']);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected readonly today = todayKey;
}
