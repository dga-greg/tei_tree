import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, type OnDestroy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideRefreshCw, LucideTriangleAlert } from '@lucide/angular';
import { BIRTH_ERA_LABELS, BIRTH_ERAS, type GenerationConflictView, type GenerationSummary } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { GenerationsApi } from '../../core/generations/generations.api';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { GenerationBadgeComponent } from '../../shared/ui/generation-badge.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { StatTileComponent } from '../../shared/ui/stat-tile.component';

@Component({
  selector: 'fh-generations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    AlertComponent,
    SpinnerComponent,
    StatTileComponent,
    BarChartComponent,
    GenerationBadgeComponent,
    PersonAvatarComponent,
    NoFamilyComponent,
    LucideRefreshCw,
    LucideTriangleAlert,
    TranslatePipe,
  ],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (summary(); as s) {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Generations' | t }}</h1>
          <p class="mt-1 text-sm text-stone-500">
            @if (s.founder; as f) {
              {{ 'Counted from the founding ancestor,' | t }} <a [routerLink]="['/members', f.id]" class="font-medium text-brand-700 hover:underline dark:text-brand-300">{{ f.displayName }}</a> {{ '(Generation 1).' | t }}
            } @else {
              {{ 'Choose a founding ancestor in the family settings to start numbering generations.' | t }}
            }
          </p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-stone-500" role="status">
            @if (s.state.status !== 'idle') { {{ 'Recalculating…' | t }} } @else if (s.computedAt) { {{ 'Updated {time}' | t: { time: ago(s.computedAt) } }} }
          </span>
          @if (context.can('generation.recalculate')) {
            <button type="button" class="btn-secondary" [disabled]="busy() || s.state.status !== 'idle'" (click)="recalculate()">
              <svg lucideRefreshCw class="size-4"></svg> {{ 'Recalculate' | t }}
            </button>
          }
        </div>
      </header>

      @if (message(); as m) { <fh-alert [tone]="m.tone" class="mb-4">{{ m.text }}</fh-alert> }

      <section [attr.aria-label]="'Totals' | t" class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <fh-stat-tile [label]="'Generations' | t" [value]="s.totals.generations" />
        <fh-stat-tile [label]="'People numbered' | t" [value]="numbered()" [note]="'{count, plural, one {of # person} other {of # people}}' | t: { count: s.totals.members }" />
        <fh-stat-tile [label]="'Conflicts' | t" [value]="s.totals.conflicts" [note]="s.totals.conflicts ? ('need review' | t) : ''" />
        <fh-stat-tile [label]="'Married in' | t" [value]="s.totals.marriedIn" />
        <fh-stat-tile [label]="'Not connected' | t" [value]="s.totals.unconnected" />
      </section>

      @if (s.byGeneration.length) {
        <section class="card mb-6 p-5" aria-labelledby="chart-h">
          <h2 id="chart-h" class="text-lg font-semibold">{{ 'People in each generation' | t }}</h2>
          <p class="mb-4 text-xs text-stone-500">{{ 'Living, unknown and deceased people per generation. The table below lists the same figures.' | t }}</p>
          <fh-bar-chart [labels]="chartLabels()" [series]="chartSeries()" [tooltipTitle]="genTitle" [ariaLabel]="chartSummary()" [height]="260" />
        </section>

        <section class="card mb-6 overflow-hidden" aria-labelledby="table-h">
          <h2 id="table-h" class="p-5 pb-3 text-lg font-semibold">{{ 'By generation' | t }}</h2>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[640px] text-left text-sm">
              <thead class="bg-stone-50 text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900">
                <tr>
                  <th scope="col" class="px-5 py-3 font-semibold">{{ 'Generation' | t }}</th>
                  <th scope="col" class="px-5 py-3 text-right font-semibold">{{ 'People' | t }}</th>
                  <th scope="col" class="px-5 py-3 text-right font-semibold">{{ 'Living' | t }}</th>
                  <th scope="col" class="px-5 py-3 text-right font-semibold">{{ 'Deceased' | t }}</th>
                  <th scope="col" class="px-5 py-3 text-right font-semibold">{{ 'Unknown' | t }}</th>
                  <th scope="col" class="px-5 py-3 font-semibold">{{ 'Recorded births' | t }}</th>
                  <th scope="col" class="px-5 py-3"><span class="sr-only">{{ 'Actions' | t }}</span></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-200 tabular-nums dark:divide-stone-800">
                @for (g of s.byGeneration; track g.number) {
                  <tr>
                    <th scope="row" class="px-5 py-3 font-medium"><fh-generation-badge [generation]="{ number: g.number, status: g.number === 1 ? 'founder' : 'computed', candidates: [], overridden: false }" /></th>
                    <td class="px-5 py-3 text-right">{{ g.total }}</td>
                    <td class="px-5 py-3 text-right">{{ g.living }}</td>
                    <td class="px-5 py-3 text-right">{{ g.deceased }}</td>
                    <td class="px-5 py-3 text-right">{{ g.unknown }}</td>
                    <td class="px-5 py-3 text-stone-600 dark:text-stone-300">{{ range(g.earliestBirthYear, g.latestBirthYear) }}</td>
                    <td class="px-5 py-3 text-right"><a [routerLink]="['/members']" [queryParams]="{ generation: g.number }" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'View people' | t }}</a></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      @if (s.byEra.length) {
        <section class="card mb-6 p-5" aria-labelledby="eras-h">
          <h2 id="eras-h" class="text-lg font-semibold">{{ 'By era of birth' | t }}</h2>
          <p class="mt-1 max-w-3xl text-sm text-stone-500">
            {{ 'People born in the same years, such as Generation X or Millennials, whatever their place in the family line. Worked out from recorded birth years.' | t }}
          </p>
          <ul class="mt-5 space-y-3">
            @for (e of eras(); track e.key) {
              <li class="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3rem]">
                <span class="min-w-0">
                  <span class="block truncate font-medium">{{ e.name | t }}</span>
                  <span class="block text-xs text-stone-500 tabular-nums">{{ e.from }}–{{ e.to }}</span>
                </span>
                <span class="h-2.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" aria-hidden="true">
                  <span class="block h-full rounded-full bg-brand-500" [style.width.%]="e.share"></span>
                </span>
                <span class="text-right font-semibold tabular-nums">{{ e.count }}</span>
              </li>
            }
          </ul>
          @if (s.eraUnknown) {
            <p class="mt-4 text-xs text-stone-500">{{ '{count, plural, one {# person has no known birth year and is not counted.} other {# people have no known birth year and are not counted.}}' | t: { count: s.eraUnknown } }}</p>
          }
        </section>
      }

      <section class="card p-5" aria-labelledby="conflicts-h">
        <h2 id="conflicts-h" class="flex items-center gap-2 text-lg font-semibold">
          @if (openConflicts() > 0) { <svg lucideTriangleAlert class="size-5 text-gold-700"></svg> }
          {{ 'Conflicting generation numbers' | t }}
        </h2>
        <p class="mt-1 text-sm text-stone-500">
          {{ 'When two verified lines of descent give different numbers — for example a marriage between cousins of different generations — the person is not numbered automatically. An administrator chooses the number, and the reason is recorded.' | t }}
        </p>
        @if (conflicts().length === 0) {
          <p class="mt-4 text-sm">{{ 'No conflicts. Every connected person has a single generation number.' | t }}</p>
        } @else {
          <ul class="mt-4 divide-y divide-stone-200 dark:divide-stone-800">
            @for (c of conflicts(); track c.person.id) {
              <li class="flex flex-wrap items-center gap-3 py-3">
                <fh-person-avatar [name]="c.person.displayName" size="sm" />
                <div class="min-w-0 flex-1">
                  <a [routerLink]="['/members', c.person.id]" class="font-medium hover:underline">{{ c.person.displayName }}</a>
                  <p class="text-xs text-stone-500">
                    {{ 'Paths give generation {numbers}' | t: { numbers: alternatives(c.candidates) } }}
                    @if (c.resolution; as r) { · {{ 'resolved as G{number}: “{reason}”' | t: { number: r.number, reason: r.reason } }} }
                  </p>
                </div>
                @if (context.can('generation.recalculate')) {
                  @if (c.resolution) {
                    <button type="button" class="btn-ghost !py-1.5 text-xs" (click)="clear(c)">{{ 'Undo resolution' | t }}</button>
                  } @else if (resolving() === c.person.id) {
                    <form [formGroup]="resolveForm" (ngSubmit)="resolve(c)" class="flex w-full flex-wrap items-end gap-2 sm:w-auto">
                      <div>
                        <label class="label !mb-1 text-xs" for="res-number">{{ 'Generation' | t }}</label>
                        <select id="res-number" class="input !py-1.5" formControlName="number">
                          @for (n of c.candidates; track n) { <option [ngValue]="n">G{{ n }}</option> }
                        </select>
                      </div>
                      <div class="min-w-48 flex-1">
                        <label class="label !mb-1 text-xs" for="res-reason">{{ 'Reason' | t }}</label>
                        <input id="res-reason" class="input !py-1.5" formControlName="reason" [placeholder]="'e.g. counted through the father by custom' | t" />
                      </div>
                      <button type="submit" class="btn-primary !py-1.5 text-xs" [disabled]="resolveForm.invalid || busy()">{{ 'Save' | t }}</button>
                      <button type="button" class="btn-ghost !py-1.5 text-xs" (click)="resolving.set(null)">{{ 'Cancel' | t }}</button>
                    </form>
                  } @else {
                    <button type="button" class="btn-secondary !py-1.5 text-xs" (click)="startResolve(c)">{{ 'Resolve' | t }}</button>
                  }
                }
              </li>
            }
          </ul>
        }
      </section>
    } @else if (error(); as e) {
      <fh-alert>{{ e }}</fh-alert>
    } @else {
      <fh-spinner [showLabel]="true" />
    }
  `,
})
export class GenerationsPage implements OnDestroy {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(GenerationsApi);

  protected readonly summary = signal<GenerationSummary | null>(null);
  protected readonly conflicts = signal<GenerationConflictView[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly resolving = signal<string | null>(null);
  protected readonly resolveForm = inject(NonNullableFormBuilder).group({
    number: [0, Validators.required],
    reason: ['', [Validators.required, Validators.minLength(3)]],
  });
  private poll: ReturnType<typeof setTimeout> | null = null;

  protected readonly numbered = computed(() => this.summary()?.byGeneration.reduce((n, g) => n + g.total, 0) ?? 0);
  /** Eras of birth with their people, oldest first; bars relative to the largest. */
  protected readonly eras = computed(() => {
    const rows = this.summary()?.byEra ?? [];
    const max = Math.max(1, ...rows.map((r) => r.count));
    return rows.map((r) => {
      const era = BIRTH_ERAS.find((e) => e.key === r.era)!;
      return { key: r.era, name: BIRTH_ERA_LABELS[r.era].name, from: era.from, to: era.to, count: r.count, share: (r.count / max) * 100 };
    });
  });
  protected readonly openConflicts = computed(() => this.conflicts().filter((c) => !c.resolution).length);
  protected readonly chartLabels = computed(() => (this.summary()?.byGeneration ?? []).map((g) => `G${g.number}`));
  protected readonly chartSeries = computed(() => {
    const b = this.summary()?.byGeneration ?? [];
    return [
      { key: 'living' as const, label: t('Living'), values: b.map((g) => g.living) },
      { key: 'unknown' as const, label: t('Unknown'), values: b.map((g) => g.unknown) },
      { key: 'deceased' as const, label: t('Deceased'), values: b.map((g) => g.deceased) },
    ];
  });
  protected readonly chartSummary = computed(() =>
    t('People per generation: {list}', {
      list: (this.summary()?.byGeneration ?? []).map((g) => t('generation {number}, {total}', { number: g.number, total: g.total })).join('; '),
    }),
  );
  protected readonly genTitle = (label: string) => t('Generation {number}', { number: label.slice(1) });

  /** "2 or 3" */
  protected alternatives(numbers: number[]): string {
    return numbers.join(` ${t('or')} `);
  }

  constructor() {
    effect(() => {
      const family = this.context.active();
      if (family) untracked(() => void this.load(family.id));
    });
  }

  private async load(familyId: string): Promise<void> {
    try {
      const [summary, conflicts] = await Promise.all([this.api.summary(familyId), this.api.conflicts(familyId)]);
      this.summary.set(summary);
      this.conflicts.set(conflicts);
      this.error.set(null);
      // Large families are recalculated in the background; refresh until it finishes.
      if (summary.state.status !== 'idle') this.poll = setTimeout(() => void this.load(familyId), 3000);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected range(a: number | null, b: number | null): string {
    if (a == null) return '—';
    return a === b ? String(a) : `${a} – ${b}`;
  }

  protected ago(iso: string): string {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (mins < 1) return t('just now');
    if (mins < 60) return t('{minutes} min ago', { minutes: mins });
    const hours = Math.round(mins / 60);
    return hours < 24 ? t('{hours} h ago', { hours }) : new Date(iso).toLocaleDateString();
  }

  protected async recalculate(): Promise<void> {
    const family = this.context.active()!;
    this.busy.set(true);
    try {
      this.summary.set(await this.api.recalculate(family.id));
      await this.load(family.id);
      this.message.set({ tone: 'success', text: t('Generation numbers recalculated.') });
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected startResolve(c: GenerationConflictView): void {
    this.resolveForm.reset({ number: c.candidates[0] ?? 0, reason: '' });
    this.resolving.set(c.person.id);
  }

  protected async resolve(c: GenerationConflictView): Promise<void> {
    const family = this.context.active()!;
    this.busy.set(true);
    try {
      await this.api.resolve(family.id, c.person.id, this.resolveForm.getRawValue());
      this.resolving.set(null);
      this.message.set({ tone: 'success', text: t('{name} is now generation {number}; their descendants were renumbered.', { name: c.person.displayName, number: this.resolveForm.controls.number.value }) });
      await this.load(family.id);
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected async clear(c: GenerationConflictView): Promise<void> {
    const family = this.context.active()!;
    try {
      await this.api.clearResolution(family.id, c.person.id);
      await this.load(family.id);
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }

  ngOnDestroy(): void {
    if (this.poll) clearTimeout(this.poll);
  }

  protected readonly span = lifespan;
}
