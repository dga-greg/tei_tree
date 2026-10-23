import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucidePlus } from '@lucide/angular';
import { FUND_KIND_LABELS, PAYMENT_METHOD_LABELS, formatMoney, type FundContributionView, type FundView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { FamilyLifeApi } from '../../core/family-life/family-life.api';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { FundDialogComponent, type FundDialogData } from './fund-dialog.component';

type Mine = FundContributionView & { fund: { id: string; name: string; currency: string } };

/** The family's funds: dues, ceremony collections, projects and welfare. */
@Component({
  selector: 'fh-funds-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, NoFamilyComponent, SpinnerComponent, LucidePlus, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Family funds' | t }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ 'Dues and contributions: what the family has raised for ceremonies, projects and welfare, kept by its administrators and treasurers.' | t }}</p>
        </div>
        @if (context.can('finance.manage')) {
          <button type="button" class="btn-primary" (click)="create()"><svg lucidePlus class="size-4"></svg> {{ 'New fund' | t }}</button>
        }
      </header>

      @if (error(); as e) { <fh-alert class="mb-4 block">{{ e }}</fh-alert> }

      @if (funds() === null) {
        <fh-spinner [showLabel]="true" />
      } @else if (!funds()!.length) {
        <div class="card p-10 text-center">
          <p class="font-medium">{{ 'No funds yet.' | t }}</p>
          @if (context.can('finance.manage')) { <p class="mt-1 text-sm text-stone-500">{{ 'Create one for monthly dues, a funeral, a wedding or a family project.' | t }}</p> }
        </div>
      } @else {
        <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (f of funds(); track f.id) {
            <li>
              <a [routerLink]="['/funds', f.id]" class="card block h-full p-5 hover:border-brand-500">
                <div class="flex items-start justify-between gap-2">
                  <span class="text-xs font-medium uppercase tracking-wide text-stone-500">{{ kindLabels[f.kind] | t }}</span>
                  @if (f.status === 'closed') { <span class="badge bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200">{{ 'Closed' | t }}</span> }
                </div>
                <h2 class="mt-1 text-lg font-semibold">{{ f.name }}</h2>
                <p class="mt-3 text-2xl font-semibold">{{ money(f.totals.amount, f.currency) }}</p>
                <p class="text-sm text-stone-500">{{ '{count, plural, one {# contributor} other {# contributors}}' | t: { count: f.totals.contributors } }}@if (f.dues) { · {{ duesText(f) }} }</p> <!-- i18n-ignore -->
                @if (f.target) {
                  <div class="mt-3 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" role="progressbar" [attr.aria-valuenow]="percent(f)" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'{percent}% of {target}' | t: { percent: percent(f), target: money(f.target, f.currency) }">
                    <div class="h-full rounded-full bg-brand-600" [style.width.%]="percent(f)"></div>
                  </div>
                  <p class="mt-1 text-xs text-stone-500">{{ '{percent}% of {target}' | t: { percent: percent(f), target: money(f.target, f.currency) } }}</p>
                }
              </a>
            </li>
          }
        </ul>
      }

      @if (mine().length) {
        <section class="mt-10" aria-labelledby="mine-h">
          <h2 id="mine-h" class="text-lg font-semibold">{{ 'Your contributions' | t }}</h2>
          <div class="card mt-3 overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900"><tr><th scope="col" class="px-4 py-2">{{ 'Date' | t }}</th><th scope="col" class="px-4 py-2">{{ 'Fund' | t }}</th><th scope="col" class="px-4 py-2 text-right">{{ 'Amount' | t }}</th><th scope="col" class="px-4 py-2">{{ 'How' | t }}</th></tr></thead>
              <tbody class="divide-y divide-stone-200 dark:divide-stone-800">
                @for (c of mine(); track c.id) {
                  <tr><td class="px-4 py-2">{{ c.date }}</td><td class="px-4 py-2"><a class="hover:underline" [routerLink]="['/funds', c.fund.id]">{{ c.fund.name }}</a></td><td class="px-4 py-2 text-right tabular-nums">{{ money(c.amount, c.fund.currency) }}</td><td class="px-4 py-2">{{ methodLabels[c.method] | t }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
})
export class FundsPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(FamilyLifeApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly funds = signal<FundView[] | null>(null);
  protected readonly mine = signal<Mine[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly kindLabels = FUND_KIND_LABELS;
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly money = formatMoney;

  constructor() {
    effect(() => {
      const family = this.context.active();
      if (family) untracked(() => void this.load(family.id));
    });
  }

  private async load(familyId: string): Promise<void> {
    try {
      const [funds, mine] = await Promise.all([this.api.funds(familyId), this.api.mine(familyId).catch(() => [])]);
      this.funds.set(funds);
      this.mine.set(mine);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      this.funds.set([]);
    }
  }

  protected duesText(f: FundView): string {
    const amount = formatMoney(f.dues!.amount, f.currency);
    if (f.dues!.period === 'monthly') return t('dues {amount} a month', { amount });
    return f.dues!.period === 'yearly' ? t('dues {amount} a year', { amount }) : t('dues {amount} once', { amount });
  }

  protected percent(f: FundView): number {
    return f.target ? Math.min(100, Math.round((f.totals.amount / f.target) * 100)) : 0;
  }

  protected async create(): Promise<void> {
    const ref = this.dialog.open<FundView, FundDialogData>(FundDialogComponent, { data: { familyId: this.context.active()!.id, fund: null } });
    const fund = await firstValueFrom(ref.closed);
    if (fund) await this.router.navigate(['/funds', fund.id]);
  }
}
