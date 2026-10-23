import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideNetwork, LucideTriangleAlert } from '@lucide/angular';
import { DEFAULT_LINEAGE_SETTINGS, type LineageOverview, type LineageSide } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { FamilyLifeApi } from '../../core/family-life/family-life.api';
import { generationLabel, lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

/** The family's lines through mothers and through fathers (e.g. abusua and ntoro), with their people. */
@Component({
  selector: 'fh-lineage-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, NoFamilyComponent, PersonAvatarComponent, SpinnerComponent, LucideNetwork, LucideTriangleAlert, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Lineage' | t }}</h1>
          <p class="mt-1 max-w-3xl text-sm text-stone-500">
            {{ 'The lines people inherit: the {maternal} through their mother and the {paternal} through their father.' | t: { maternal: settings().maternal.label, paternal: settings().paternal.label } }}
            {{ 'Record a line once, on the earliest ancestor you know; everyone descended through the right parent inherits it.' | t }}
          </p>
        </div>
        <a routerLink="/tree" [queryParams]="{ colour: side() }" class="btn-secondary"><svg lucideNetwork class="size-4"></svg> {{ 'Colour the tree by {line}' | t: { line: label() } }}</a>
      </header>

      @if (sides().length > 1) {
        <div role="tablist" [attr.aria-label]="'Line' | t" class="mb-5 inline-flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
          @for (s of sides(); track s) {
            <button type="button" role="tab" [attr.aria-selected]="side() === s" class="rounded-lg px-4 py-1.5 text-sm font-medium"
                    [class]="side() === s ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-600 dark:text-stone-300'" (click)="choose(s)">
              {{ s === 'maternal' ? ('{line} (mother)' | t: { line: settings().maternal.label }) : ('{line} (father)' | t: { line: settings().paternal.label }) }}
            </button>
          }
        </div>
      }

      @if (error(); as e) { <fh-alert class="mb-4 block">{{ e }}</fh-alert> }

      @if (!sides().length) {
        <fh-alert tone="info">{{ 'This family does not record lines. Administrators can turn them on in Family Settings.' | t }}</fh-alert>
      } @else if (overview() === null) {
        <fh-spinner [showLabel]="true" />
      } @else {
        @if (!overview()!.groups.length) {
          <div class="card p-10 text-center">
            <p class="font-medium">{{ 'No {line} recorded yet.' | t: { line: label() } }}</p>
            <p class="mt-1 text-sm text-stone-500">
              @if (side() === 'maternal') {
                {{ 'Edit the profile of the earliest ancestress you know and fill in the {line}.' | t: { line: label() } }}
              } @else {
                {{ 'Edit the profile of the earliest ancestor you know and fill in the {line}.' | t: { line: label() } }}
              }
            </p>
          </div>
        }
        <div class="grid gap-5 xl:grid-cols-2">
          @for (g of overview()!.groups; track g.name) {
            <section class="card p-5" [attr.aria-labelledby]="'line-' + $index">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 [id]="'line-' + $index" class="text-xl font-semibold">{{ g.name }}</h2>
                <p class="text-sm text-stone-500">{{ '{count, plural, one {# person} other {# people} }, {living} living' | t: { count: g.members, living: g.living } }}</p>
              </div>
              @if (g.totems.length) { <p class="mt-1 text-sm">{{ 'Totem:' | t }} <strong>{{ g.totems.join(', ') }}</strong></p> }
              @if (g.roots.length) {
                <p class="mt-3 text-xs font-medium uppercase tracking-wide text-stone-500">{{ 'Recorded on' | t }}</p>
                <p class="mt-1 text-sm">
                  @for (r of g.roots; track r.id; let last = $last) {
                    <a class="font-medium hover:underline" [routerLink]="['/members', r.id]">{{ r.displayName }}</a>@if (!last) { , }
                  }
                </p>
              }
              @if (g.differences) {
                <p class="mt-2 flex items-center gap-1.5 text-sm text-amber-800 dark:text-amber-300">
                  <svg lucideTriangleAlert class="size-4" aria-hidden="true"></svg>
                  {{ '{count, plural, one {# person has a line different from the one their parent passes on.} other {# people have a line different from the one their parent passes on.} }' | t: { count: g.differences } }}
                </p>
              }
              <details class="mt-3">
                <summary class="cursor-pointer text-sm font-medium text-brand-700 dark:text-brand-300">{{ 'Everyone in the {name} line' | t: { name: g.name } }}</summary>
                <ul class="mt-2 grid gap-1 sm:grid-cols-2">
                  @for (p of g.people; track p.id) {
                    <li>
                      <a [routerLink]="['/members', p.id]" class="flex items-center gap-2 rounded-lg p-1 hover:bg-stone-50 dark:hover:bg-stone-800/60">
                        <fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" />
                        <span class="min-w-0"><span class="block truncate text-sm font-medium">{{ p.displayName }}</span><span class="block text-xs text-stone-500">{{ describe(p) }}</span></span>
                      </a>
                    </li>
                  }
                </ul>
                @if (g.members > g.people.length) { <p class="mt-1 text-xs text-stone-500">{{ 'Showing the first {count}.' | t: { count: g.people.length } }}</p> }
              </details>
            </section>
          }
        </div>
        @if (overview()!.unknown) {
          <p class="mt-6 text-sm text-stone-500">
            @if (side() === 'maternal') {
              {{ '{count, plural, one {# person has no {line} yet: none is recorded on them or on their mothers.} other {# people have no {line} yet: none is recorded on them or on their mothers.} }' | t: { count: overview()!.unknown, line: label() } }}
            } @else {
              {{ '{count, plural, one {# person has no {line} yet: none is recorded on them or on their fathers.} other {# people have no {line} yet: none is recorded on them or on their fathers.} }' | t: { count: overview()!.unknown, line: label() } }}
            }
          </p>
        }
      }
    }
  `,
})
export class LineagePage {
  /** Query parameter: which line to show. */
  readonly line = input<LineageSide>();

  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(FamilyLifeApi);
  private readonly router = inject(Router);

  protected readonly settings = computed(() => this.context.details()?.lineage ?? DEFAULT_LINEAGE_SETTINGS);
  protected readonly sides = computed<LineageSide[]>(() => (['maternal', 'paternal'] as const).filter((s) => this.settings()[s].enabled));
  protected readonly side = computed<LineageSide>(() => {
    const wanted = this.line();
    return wanted && this.sides().includes(wanted) ? wanted : (this.sides()[0] ?? 'maternal');
  });
  protected readonly label = computed(() => this.settings()[this.side()].label);
  protected readonly overview = signal<LineageOverview | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (this.context.active() && !this.context.details()) void this.context.loadDetails();
    effect(() => {
      const family = this.context.active();
      const side = this.side();
      if (family && this.sides().length) untracked(() => void this.load(family.id, side));
    });
  }

  private async load(familyId: string, side: LineageSide): Promise<void> {
    this.overview.set(null);
    this.error.set(null);
    try {
      this.overview.set(await this.api.lineages(familyId, side));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected choose(side: LineageSide): void {
    void this.router.navigate([], { queryParams: { line: side }, replaceUrl: true });
  }

  protected describe(p: Parameters<typeof lifespan>[0] & { generation: Parameters<typeof generationLabel>[0] }): string {
    return [lifespan(p), generationLabel(p.generation)].filter(Boolean).join(' · ');
  }
}
