import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideArchive,
  LucideDynamicIcon,
  LucideFileUp,
  LucideLayers,
  LucideMail,
  LucideNetwork,
  LucidePlus,
  LucideSprout,
  LucideTreePine,
  LucideUserPlus,
  LucideWaypoints,
  type LucideIcon,
} from '@lucide/angular';
import { FAMILY_ROLE_LABELS, type FamilyDashboard, type FamilyRole } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { GenerationsApi } from '../../core/generations/generations.api';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TourService } from '../../core/tour/tour.service';
import { BarChartComponent } from '../../shared/charts/bar-chart.component';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { GenerationBadgeComponent } from '../../shared/ui/generation-badge.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PendingInvitationsComponent } from '../invitations/pending-invitations.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { StatTileComponent } from '../../shared/ui/stat-tile.component';
import { ComingUpComponent } from '../calendar/coming-up.component';

interface QuickAction {
  label: string;
  icon: LucideIcon;
  path: string;
  phase?: number;
  show: boolean;
  /** Marks the button for the welcome tour. */
  tour?: string;
}

const MONTHS = [mark('Jan'), mark('Feb'), mark('Mar'), mark('Apr'), mark('May'), mark('Jun'), mark('Jul'), mark('Aug'), mark('Sep'), mark('Oct'), mark('Nov'), mark('Dec')];

@Component({
  selector: 'fh-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    LucideDynamicIcon,
    LucideArrowRight,
    LucideTreePine,
    LucideSprout,
    LucideFileUp,
    AlertComponent,
    SpinnerComponent,
    NoFamilyComponent,
    PendingInvitationsComponent,
    StatTileComponent,
    BarChartComponent,
    PersonAvatarComponent,
    GenerationBadgeComponent,
    ComingUpComponent,
    TranslatePipe,
  ],
  template: `
    <header class="mb-6 flex items-end justify-between gap-4 sm:mb-8">
      <div class="min-w-0">
        <p class="text-sm font-medium text-brand-700 dark:text-brand-300">{{ greeting() }}</p>
        <h1 class="mt-1 truncate text-3xl font-semibold sm:text-4xl">{{ families.active()?.name ?? ('Welcome' | t) }}</h1>
      </div>
      @if (families.families().length > 0) {
        <!-- On phones a small "+ Family" link; the full button from sm up. -->
        <a routerLink="/families/new" class="btn-secondary hidden shrink-0 sm:inline-flex">{{ 'Register another family' | t }}</a>
        <a routerLink="/families/new" class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-brand-700 hover:underline sm:hidden dark:text-brand-300" [attr.aria-label]="'Register another family' | t">
          <svg [lucideIcon]="plusIcon" class="size-4"></svg> {{ 'Family' | t }}
        </a>
      }
    </header>

    <fh-pending-invitations />

    @if (families.loading() && !families.loaded()) {
      <fh-spinner [showLabel]="true" [label]="'Loading your families…' | t" />
    } @else if (families.error(); as error) {
      <fh-alert>{{ error }}</fh-alert>
    } @else if (families.families().length === 0) {
      <fh-no-family />
    } @else {
      <nav [attr.aria-label]="'Quick actions' | t" class="mb-6">
        <!-- Phones: a grid of tiles, icon above the label. Wider screens: a row of buttons. -->
        <ul class="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          @for (a of actions(); track a.label) {
            @if (a.show) {
              <li class="flex">
                <a [routerLink]="a.path" [attr.data-tour]="a.tour" class="btn-secondary w-full flex-col !gap-1.5 !px-2 !py-3 text-center !text-xs leading-tight sm:w-auto sm:flex-row sm:!gap-2 sm:!px-4 sm:!py-2 sm:text-left sm:!text-sm" [class.opacity-70]="a.phase">
                  <svg [lucideIcon]="a.icon" class="size-5 shrink-0 sm:size-4"></svg> <span>{{ a.label }}</span>
                  @if (a.phase) { <span class="badge bg-stone-100 text-[10px] text-stone-500 dark:bg-stone-800">{{ 'Phase {n}' | t: { n: a.phase } }}</span> }
                </a>
              </li>
            }
          }
        </ul>
      </nav>

      @if (dash(); as d) {
        @if (d.state.status !== 'idle') {
          <fh-alert tone="info" class="mb-4">{{ 'Generation numbers are being recalculated. Figures will update shortly.' | t }}</fh-alert>
        }
        @if (d.stats.members <= 1) {
          <!-- A new family: only the founding ancestor so far. -->
          <section class="card relative mb-6 overflow-hidden p-5 sm:p-6" aria-labelledby="start-h" data-testid="start-tree">
            <div class="absolute -right-10 -top-10 size-40 rounded-full bg-brand-50 dark:bg-brand-950" aria-hidden="true"></div>
            <div class="relative flex gap-4">
              <span class="hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 sm:inline-flex dark:bg-brand-900 dark:text-brand-100">
                <svg lucideSprout class="size-6"></svg>
              </span>
              <div class="min-w-0">
                <h2 id="start-h" class="text-lg font-semibold">{{ 'Start your family tree' | t }}</h2>
                <p class="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-400">
                  {{ 'So far the tree has only the founding ancestor. Add their partner and children, then each generation down to you. Invite relatives so they can add the people and stories they know.' | t }}
                </p>
                <div class="mt-4 flex flex-wrap gap-2">
                  @if (families.can('member.create')) { <a routerLink="/members/new" class="btn-primary">{{ 'Add family member' | t }}</a> }
                  @if (families.can('invitation.manage')) { <a routerLink="/invitations" class="btn-secondary">{{ 'Invite relatives' | t }}</a> }
                </div>
                @if (families.can('family.import')) {
                  <a routerLink="/family/import" class="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                    <svg lucideFileUp class="size-4"></svg> {{ 'Already have a tree in another program? Import a GEDCOM file' | t }}
                  </a>
                }
              </div>
            </div>
          </section>
        }

        <section [attr.aria-label]="'Family statistics' | t" class="mb-6 grid grid-cols-3 gap-2 sm:gap-3 xl:grid-cols-6">
          <fh-stat-tile [label]="'Family members' | t" [value]="d.stats.members" />
          <fh-stat-tile [label]="'Generations' | t" [value]="d.stats.generations" [note]="d.stats.conflicts ? ('{count} to review' | t: { count: d.stats.conflicts }) : ''" />
          <fh-stat-tile [label]="'Living' | t" [value]="d.stats.living" />
          <fh-stat-tile [label]="'Deceased' | t" [value]="d.stats.deceased" />
          <fh-stat-tile [label]="'Branches' | t" [value]="d.stats.branches" />
          <a routerLink="/contributions" class="rounded-2xl focus-visible:outline-2"><fh-stat-tile [label]="'Open suggestions' | t" [value]="d.stats.pendingContributions" [note]="families.can('contribution.review') ? ('awaiting review' | t) : ('yours, in progress' | t)" /></a>
        </section>

        <fh-coming-up [familyId]="families.active()!.id" />

        <div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section class="card p-4 sm:p-5" aria-labelledby="gen-chart-h">
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="gen-chart-h" class="text-lg font-semibold">{{ 'Members per generation' | t }}</h2>
              <a routerLink="/generations" class="whitespace-nowrap text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'Explore generations' | t }}</a>
            </div>
            @if (d.byGeneration.length) {
              <fh-bar-chart class="mt-3" [labels]="genLabels()" [series]="genSeries()" [tooltipTitle]="genTitle" [ariaLabel]="genSummary()" />
              <details class="mt-3 text-sm">
                <summary class="cursor-pointer text-stone-500">{{ 'Show as table' | t }}</summary>
                <table class="mt-2 w-full text-left tabular-nums">
                  <thead class="text-xs text-stone-500"><tr><th scope="col" class="py-1">{{ 'Generation' | t }}</th><th scope="col" class="py-1 text-right">{{ 'Living' | t }}</th><th scope="col" class="py-1 text-right">{{ 'Unknown' | t }}</th><th scope="col" class="py-1 text-right">{{ 'Deceased' | t }}</th><th scope="col" class="py-1 text-right">{{ 'Total' | t }}</th></tr></thead>
                  <tbody>
                    @for (g of d.byGeneration; track g.number) {
                      <tr class="border-t border-stone-100 dark:border-stone-800"><th scope="row" class="py-1 font-medium">G{{ g.number }}</th><td class="text-right">{{ g.living }}</td><td class="text-right">{{ g.unknown }}</td><td class="text-right">{{ g.deceased }}</td><td class="text-right">{{ g.total }}</td></tr>
                    }
                  </tbody>
                </table>
              </details>
            } @else {
              <p class="mt-3 text-sm text-stone-500">{{ 'Add the founding ancestor and their descendants to see generations here.' | t }}</p>
            }
          </section>

          <section class="card p-4 sm:p-5" aria-labelledby="recent-h">
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="recent-h" class="text-lg font-semibold">{{ 'Recently added' | t }}</h2>
              <a routerLink="/members" [queryParams]="{ sort: 'recent' }" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'All members' | t }}</a>
            </div>
            <ul class="mt-3 space-y-1">
              @for (p of d.recentlyAdded; track p.id) {
                <li>
                  <a [routerLink]="['/members', p.id]" class="flex items-center gap-3 rounded-xl p-1.5 hover:bg-stone-50 dark:hover:bg-stone-800/60">
                    <fh-person-avatar [name]="p.displayName" size="sm" />
                    <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">{{ p.displayName }}</span><span class="block text-xs text-stone-500">{{ span(p) || '—' }}</span></span>
                    <fh-generation-badge [generation]="p.generation" />
                  </a>
                </li>
              } @empty {
                <li class="text-sm text-stone-500">{{ 'No one yet.' | t }}</li>
              }
            </ul>
          </section>

          <section class="card p-4 sm:p-5 xl:col-span-2" aria-labelledby="growth-h">
            <h2 id="growth-h" class="text-lg font-semibold">{{ 'Family growth' | t }}</h2>
            <p class="text-xs text-stone-500">{{ 'People added to the tree each month over the last year.' | t }}</p>
            <fh-bar-chart class="mt-3" [labels]="growthLabels()" [series]="growthSeries()" [height]="180" [ariaLabel]="growthSummary()" [tooltipTitle]="growthTitle" />
          </section>
        </div>
      } @else if (dashError(); as e) {
        <fh-alert>{{ e }}</fh-alert>
      } @else {
        <fh-spinner [showLabel]="true" />
      }

      @if (families.families().length > 1) {
        <section aria-labelledby="families-heading" class="mt-10">
          <h2 id="families-heading" class="mb-4 text-xl font-semibold">{{ 'Your families' | t }}</h2>
          <ul class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            @for (f of families.families(); track f.id) {
              <li class="card flex items-center gap-3 p-4" [class.ring-2]="f.id === families.active()?.id" [class.ring-brand-500]="f.id === families.active()?.id">
                <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gen-1-tint text-gen-1-ink"><svg lucideTreePine class="size-5"></svg></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold">{{ f.name }}</p>
                  <p class="text-xs text-stone-500">{{ roleLabel(f.role) | t }} · {{ '{count} people' | t: { count: f.memberCount } }}</p>
                </div>
                @if (f.id !== families.active()?.id) {
                  <button type="button" class="btn-ghost !px-2 !py-1 text-xs" (click)="families.select(f.id)">{{ 'Open' | t }} <svg lucideArrowRight class="size-3.5"></svg></button>
                }
              </li>
            }
          </ul>
        </section>
      }
    }
  `,
})
export class DashboardPage {
  protected readonly auth = inject(AuthStore);
  protected readonly families = inject(FamilyContextStore);
  private readonly generationsApi = inject(GenerationsApi);
  private readonly tour = inject(TourService);

  protected readonly dash = signal<FamilyDashboard | null>(null);
  protected readonly dashError = signal<string | null>(null);
  protected readonly span = lifespan;

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    const name = this.auth.user()?.displayName ?? '';
    return h < 12 ? t('Good morning, {name}', { name }) : h < 18 ? t('Good afternoon, {name}', { name }) : t('Good evening, {name}', { name });
  });

  protected readonly plusIcon = LucidePlus;

  protected readonly actions = computed<QuickAction[]>(() => [
    { label: t('Add family member'), icon: LucideUserPlus, path: '/members/new', show: this.families.can('member.create'), tour: 'add-member' },
    { label: t('Explore generations'), icon: LucideLayers, path: '/generations', show: true },
    { label: t('View family tree'), icon: LucideNetwork, path: '/tree', show: true, tour: 'tree' },
    { label: t('Find relationship'), icon: LucideWaypoints, path: '/relationships', show: true },
    { label: t('Invite family member'), icon: LucideMail, path: '/invitations', show: this.families.can('invitation.manage') },
    { label: t('Family history'), icon: LucideArchive, path: '/history', show: true },
  ]);

  protected readonly genLabels = computed(() => (this.dash()?.byGeneration ?? []).map((g) => `G${g.number}`));
  protected readonly genSeries = computed(() => {
    const b = this.dash()?.byGeneration ?? [];
    return [
      { key: 'living' as const, label: t('Living'), values: b.map((g) => g.living) },
      { key: 'unknown' as const, label: t('Unknown'), values: b.map((g) => g.unknown) },
      { key: 'deceased' as const, label: t('Deceased'), values: b.map((g) => g.deceased) },
    ];
  });
  protected readonly genSummary = computed(() =>
    t('Members per generation: {list}', {
      list: (this.dash()?.byGeneration ?? []).map((g) => t('generation {number}, {total}', { number: g.number, total: g.total })).join('; '),
    }),
  );
  protected readonly genTitle = (label: string) => t('Generation {number}', { number: label.slice(1) });

  protected readonly growthLabels = computed(() => (this.dash()?.growth ?? []).map((g) => t(MONTHS[Number(g.month.slice(5)) - 1]!)));
  protected readonly growthSeries = computed(() => [{ key: 'single' as const, label: t('People added'), values: (this.dash()?.growth ?? []).map((g) => g.added) }]);
  protected readonly growthSummary = computed(() =>
    t('People added per month: {list}', { list: (this.dash()?.growth ?? []).map((g) => `${g.month}, ${g.added}`).join('; ') }),
  );
  protected readonly growthTitle = (label: string) => {
    const point = this.dash()?.growth.find((g) => t(MONTHS[Number(g.month.slice(5)) - 1]!) === label);
    return point ? `${label} ${point.month.slice(0, 4)}` : label;
  };

  constructor() {
    effect(() => {
      const family = this.families.active();
      if (family) untracked(() => void this.load(family.id));
    });
  }

  private async load(familyId: string): Promise<void> {
    this.dash.set(null);
    try {
      const dash = await this.generationsApi.dashboard(familyId);
      // Switched family while this was loading: the newer request fills the page.
      if (this.families.active()?.id !== familyId) return;
      this.dash.set(dash);
      this.dashError.set(null);
      // First visit: the welcome tour, once the page has settled.
      setTimeout(() => this.tour.offer(), 300);
    } catch (err) {
      this.dashError.set(ApiError.from(err).message);
    }
  }

  protected roleLabel(role: FamilyRole) {
    return FAMILY_ROLE_LABELS[role];
  }
}
