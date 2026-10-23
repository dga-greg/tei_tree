import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideDynamicIcon, LucidePlus, LucideWallet } from '@lucide/angular';
import { EVENT_KIND_LABELS, fuzzyDateSortKey, type EventView } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { TIMELINE_ICONS } from '../history/timeline-kinds';

/** Naming ceremonies, engagements, weddings, funerals and other family ceremonies, coming and past. */
@Component({
  selector: 'fh-ceremonies-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDynamicIcon, RouterLink, AlertComponent, NoFamilyComponent, PersonAvatarComponent, SpinnerComponent, LucidePlus, LucideWallet, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Ceremonies' | t }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ "Naming ceremonies, engagements, weddings, funerals, one-week observances and thanksgivings: the programme, who does what, photos, and the family's contributions." | t }}</p>
        </div>
        @if (context.can('event.manage')) {
          <a routerLink="/ceremonies/new" class="btn-primary"><svg lucidePlus class="size-4"></svg> {{ 'Plan a ceremony' | t }}</a>
        }
      </header>

      @if (error(); as e) { <fh-alert class="mb-4 block">{{ e }}</fh-alert> }

      @if (items() === null) {
        <fh-spinner [showLabel]="true" />
      } @else if (!items()!.length) {
        <div class="card p-10 text-center">
          <p class="font-medium">{{ 'No ceremonies recorded yet.' | t }}</p>
          <p class="mt-1 text-sm text-stone-500">{{ 'Record an upcoming ceremony to share its programme, or a past one to keep its memory.' | t }}</p>
        </div>
      } @else {
        @for (group of groups(); track group.title) {
          @if (group.items.length) {
            <section class="mb-8" [attr.aria-labelledby]="'cg-' + $index">
              <h2 [id]="'cg-' + $index" class="mb-3 text-lg font-semibold">{{ group.title }}</h2>
              <ul class="grid gap-4 lg:grid-cols-2">
                @for (c of group.items; track c.id) {
                  <li>
                    <a [routerLink]="['/ceremonies', c.id]" class="card flex gap-4 p-4 hover:border-brand-500">
                      <span class="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200" aria-hidden="true">
                        <svg [lucideIcon]="icons[c.kind]" class="size-5"></svg>
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block text-xs font-medium uppercase tracking-wide text-stone-500">{{ kindLabels[c.kind] | t }}</span>
                        <span class="block font-semibold">{{ c.title }}</span>
                        <span class="block text-sm text-stone-500">{{ date(c) }}@if (c.place) { · {{ c.place }} }</span>
                        @if (c.fund) { <span class="mt-1 inline-flex items-center gap-1 text-xs text-brand-700 dark:text-brand-300"><svg lucideWallet class="size-3.5" aria-hidden="true"></svg> {{ c.fund.name }}</span> }
                      </span>
                      <span class="flex -space-x-2 self-center">
                        @for (p of c.people.slice(0, 3); track p.id) { <span class="rounded-full ring-2 ring-white dark:ring-stone-900"><fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" /></span> }
                      </span>
                    </a>
                  </li>
                }
              </ul>
            </section>
          }
        }
      }
    }
  `,
})
export class CeremoniesPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly archive = inject(ArchiveApi);
  protected readonly items = signal<EventView[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly kindLabels = EVENT_KIND_LABELS;
  protected readonly icons = TIMELINE_ICONS;

  /** Coming (today or later, soonest first) and past (most recent first). */
  protected readonly groups = computed(() => {
    const now = new Date();
    const today = fuzzyDateSortKey({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })!;
    const key = (c: EventView) => c.date?.sortKey ?? null;
    const all = this.items() ?? [];
    const coming = all.filter((c) => (key(c) ?? 0) >= today || (c.date?.year === now.getFullYear() && !c.date.day && (c.date.month ?? 13) >= now.getMonth() + 1));
    const past = all.filter((c) => !coming.includes(c));
    return [
      { title: t('Coming up'), items: coming.sort((a, b) => (key(a) ?? 0) - (key(b) ?? 0)) },
      { title: t('Past ceremonies'), items: past.sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0)) },
    ];
  });

  constructor() {
    effect(() => {
      const family = this.context.active();
      if (family) untracked(() => void this.load(family.id));
    });
  }

  private async load(familyId: string): Promise<void> {
    try {
      this.items.set(await this.archive.events(familyId, { ceremonies: true }));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      this.items.set([]);
    }
  }

  protected date(c: EventView): string {
    return c.date ? formatFuzzyDate(c.date) : t('Date not set');
  }
}
