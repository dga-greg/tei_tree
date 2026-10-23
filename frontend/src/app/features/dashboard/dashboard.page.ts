import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideArrowRight, LucideNetwork, LucidePlus, LucideSprout, LucideTreePine, LucideUserPlus, LucideUsers } from '@lucide/angular';
import { FAMILY_ROLE_LABELS, type FamilyDashboard, type FamilyRole, type MemberView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { GenerationsApi } from '../../core/generations/generations.api';
import { MembersApi } from '../../core/members/members.api';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TourService } from '../../core/tour/tour.service';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FamilyCodeComponent } from '../../shared/ui/family-code.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { StatTileComponent } from '../../shared/ui/stat-tile.component';

@Component({
  selector: 'fh-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    LucideArrowRight,
    LucideNetwork,
    LucidePlus,
    LucideSprout,
    LucideTreePine,
    LucideUserPlus,
    LucideUsers,
    AlertComponent,
    SpinnerComponent,
    NoFamilyComponent,
    StatTileComponent,
    PersonAvatarComponent,
    FamilyCodeComponent,
    TranslatePipe,
  ],
  template: `
    <header class="mb-6 flex items-end justify-between gap-4 sm:mb-8">
      <div class="min-w-0">
        <p class="text-sm font-medium text-brand-700 dark:text-brand-300">{{ greeting() }}</p>
        <h1 class="mt-1 truncate text-3xl font-semibold sm:text-4xl">{{ families.active()?.name ?? ('Welcome' | t) }}</h1>
      </div>
      @if (families.families().length > 0) {
        <a routerLink="/families/new" class="btn-secondary hidden shrink-0 sm:inline-flex">{{ 'Register another family' | t }}</a>
        <a routerLink="/families/new" class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-brand-700 hover:underline sm:hidden dark:text-brand-300" [attr.aria-label]="'Register another family' | t">
          <svg lucidePlus class="size-4"></svg> {{ 'Family' | t }}
        </a>
      }
    </header>

    @if (families.loading() && !families.loaded()) {
      <fh-spinner [showLabel]="true" [label]="'Loading your families…' | t" />
    } @else if (families.error(); as error) {
      <fh-alert>{{ error }}</fh-alert>
    } @else if (families.families().length === 0) {
      <fh-no-family />
    } @else {
      <nav [attr.aria-label]="'Quick actions' | t" class="mb-6">
        <ul class="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          @if (families.can('member.create')) {
            <li class="flex">
              <a routerLink="/members/new" data-tour="add-member" class="btn-secondary w-full flex-col !gap-1.5 !px-2 !py-3 text-center !text-xs leading-tight sm:w-auto sm:flex-row sm:!gap-2 sm:!px-4 sm:!py-2 sm:text-left sm:!text-sm">
                <svg lucideUserPlus class="size-5 shrink-0 sm:size-4"></svg> <span>{{ 'Add family member' | t }}</span>
              </a>
            </li>
          }
          <li class="flex">
            <a routerLink="/tree" data-tour="tree" class="btn-secondary w-full flex-col !gap-1.5 !px-2 !py-3 text-center !text-xs leading-tight sm:w-auto sm:flex-row sm:!gap-2 sm:!px-4 sm:!py-2 sm:text-left sm:!text-sm">
              <svg lucideNetwork class="size-5 shrink-0 sm:size-4"></svg> <span>{{ 'View family tree' | t }}</span>
            </a>
          </li>
          <li class="flex">
            <a routerLink="/members" class="btn-secondary w-full flex-col !gap-1.5 !px-2 !py-3 text-center !text-xs leading-tight sm:w-auto sm:flex-row sm:!gap-2 sm:!px-4 sm:!py-2 sm:text-left sm:!text-sm">
              <svg lucideUsers class="size-5 shrink-0 sm:size-4"></svg> <span>{{ 'All family members' | t }}</span>
            </a>
          </li>
        </ul>
      </nav>

      @if (dash(); as d) {
        @if (d.stats.members <= 1) {
          <!-- A new family: only the family head so far. -->
          <section class="card relative mb-6 overflow-hidden p-5 sm:p-6" aria-labelledby="start-h" data-testid="start-tree">
            <div class="absolute -right-10 -top-10 size-40 rounded-full bg-brand-50 dark:bg-brand-950" aria-hidden="true"></div>
            <div class="relative flex gap-4">
              <span class="hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 sm:inline-flex dark:bg-brand-900 dark:text-brand-100">
                <svg lucideSprout class="size-6"></svg>
              </span>
              <div class="min-w-0">
                <h2 id="start-h" class="text-lg font-semibold">{{ 'Start your family tree' | t }}</h2>
                <p class="mt-1 max-w-2xl text-sm text-stone-600 dark:text-stone-400">
                  {{ 'So far the tree has only the family head (G1). Add their husband or wife and children: the children become G1.1, G1.2 and so on, and their children G1.1.1, G1.1.2.' | t }}
                </p>
                @if (families.can('member.create')) {
                  <a routerLink="/members/new" class="btn-primary mt-4">{{ 'Add family member' | t }}</a>
                }
              </div>
            </div>
          </section>
        }

        <section [attr.aria-label]="'Family figures' | t" class="mb-6 grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-5">
          <fh-stat-tile [label]="'Family members' | t" [value]="d.stats.members" />
          <fh-stat-tile [label]="'Living' | t" [value]="d.stats.living" />
          <fh-stat-tile [label]="'Deceased' | t" [value]="d.stats.deceased" />
          <fh-stat-tile [label]="'Unknown' | t" [value]="unknownCount()" />
          <fh-stat-tile [label]="'Generations' | t" [value]="d.stats.generations" />
        </section>

        <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section class="card p-4 sm:p-5" aria-labelledby="head-h">
            <h2 id="head-h" class="text-lg font-semibold">{{ 'Family head' | t }}</h2>
            @if (head(); as h) {
              <a [routerLink]="['/members', h.id]" class="mt-3 flex items-center gap-3 rounded-xl p-1.5 hover:bg-stone-50 dark:hover:bg-stone-800/60">
                <fh-person-avatar [name]="h.displayName" [photoUrl]="h.photoUrl" />
                <span class="min-w-0 flex-1"><span class="block truncate font-medium">{{ h.displayName }}</span><span class="block text-xs text-stone-500">{{ span(h) || '—' }}</span></span>
                <fh-family-code [code]="h.familyCode" />
              </a>
              @if (families.can('family.set_founder')) {
                <p class="mt-3 text-xs text-stone-500">{{ 'Found an earlier family head?' | t }} <a routerLink="/family/settings" class="font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'Change the family head' | t }}</a></p>
              }
            } @else {
              <p class="mt-3 text-sm text-stone-500">{{ 'No family head chosen yet.' | t }}</p>
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
                    <fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" />
                    <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">{{ p.displayName }}</span><span class="block text-xs text-stone-500">{{ span(p) || '—' }}</span></span>
                    <fh-family-code [code]="p.familyCode" />
                  </a>
                </li>
              } @empty {
                <li class="text-sm text-stone-500">{{ 'No one yet.' | t }}</li>
              }
            </ul>
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
  private readonly membersApi = inject(MembersApi);
  private readonly tour = inject(TourService);

  protected readonly dash = signal<FamilyDashboard | null>(null);
  protected readonly dashError = signal<string | null>(null);
  protected readonly head = signal<MemberView | null>(null);
  protected readonly span = lifespan;
  protected readonly unknownCount = computed(() => {
    const s = this.dash()?.stats;
    return s ? Math.max(0, s.members - s.living - s.deceased) : null;
  });

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    const name = this.auth.user()?.displayName ?? '';
    return h < 12 ? t('Good morning, {name}', { name }) : h < 18 ? t('Good afternoon, {name}', { name }) : t('Good evening, {name}', { name });
  });

  constructor() {
    effect(() => {
      const family = this.families.active();
      const founder = this.families.details()?.foundingMemberId ?? null;
      if (family) untracked(() => void this.load(family.id, founder));
    });
  }

  private async load(familyId: string, founderId: string | null): Promise<void> {
    this.dash.set(null);
    try {
      const [dash, head] = await Promise.all([this.generationsApi.dashboard(familyId), founderId ? this.membersApi.get(familyId, founderId).catch(() => null) : Promise.resolve(null)]);
      // Switched family while this was loading: the newer request fills the page.
      if (this.families.active()?.id !== familyId) return;
      this.dash.set(dash);
      this.head.set(head);
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
