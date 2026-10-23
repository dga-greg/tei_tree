import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideBell, LucideCake, LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideFlower, LucideFlower2, LucideHeart } from '@lucide/angular';
import { CALENDAR_KINDS, CALENDAR_KIND_LABELS, type CalendarItem, type CalendarKind } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { CalendarApi } from '../../core/calendar/calendar.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { currentLanguage, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
/** Locale for calendar dates: the chosen language's, with British day-month order for English. */
export const dateLocale = () => (currentLanguage().code === 'en' ? 'en-GB' : currentLanguage().formats);

/** Kind colours, always paired with an icon and a label (never colour alone). */
export const KIND_STYLE: Record<CalendarKind, string> = {
  birthday: 'bg-gold-100 text-gold-700 dark:bg-gold-700/40 dark:text-gold-100',
  anniversary: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
  remembrance: 'bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-100',
  birth_remembrance: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
  event: 'bg-brand-100 text-brand-900 dark:bg-brand-900/50 dark:text-brand-100',
};

interface Day {
  key: string;
  date: number;
  inMonth: boolean;
  today: boolean;
  items: CalendarItem[];
}

@Component({
  selector: 'fh-calendar-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, AlertComponent, NoFamilyComponent, PersonAvatarComponent, SpinnerComponent, LucideBell, LucideCake, LucideCalendarDays, LucideChevronLeft, LucideChevronRight, LucideFlower, LucideFlower2, LucideHeart, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Family calendar' | t }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ 'Birthdays, wedding anniversaries, days of remembrance and family events in the {family}.' | t: { family: context.active()!.name } }}</p>
        </div>
        <a routerLink="/settings" fragment="notifications" class="btn-secondary"><svg lucideBell class="size-4"></svg> {{ 'Reminders' | t }}</a>
      </header>

      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-1">
          <button type="button" class="btn-ghost !p-2" (click)="move(-1)" [attr.aria-label]="'Previous month' | t"><svg lucideChevronLeft class="size-5"></svg></button>
          <h2 class="min-w-44 text-center text-xl font-semibold" aria-live="polite">{{ monthLabel() }}</h2>
          <button type="button" class="btn-ghost !p-2" (click)="move(1)" [attr.aria-label]="'Next month' | t"><svg lucideChevronRight class="size-5"></svg></button>
          <button type="button" class="btn-secondary ml-2 !py-1.5 text-sm" (click)="goToday()">{{ 'Today' | t }}</button>
        </div>
        <fieldset class="flex flex-wrap gap-1.5">
          <legend class="sr-only">{{ 'Show' | t }}</legend>
          @for (k of kinds; track k) {
            <label class="flex cursor-pointer items-center gap-1.5 rounded-full border border-stone-300 px-3 py-1 text-xs font-medium has-[:checked]:border-transparent dark:border-stone-700"
                   [class]="shown().has(k) ? style[k] : 'text-stone-500'">
              <input type="checkbox" class="sr-only" [checked]="shown().has(k)" (change)="toggle(k)" />
              <ng-container [ngTemplateOutlet]="icon" [ngTemplateOutletContext]="{ kind: k }" />
              {{ labels[k] | t }}
            </label>
          }
        </fieldset>
      </div>

      @if (error(); as e) { <fh-alert class="mb-4 block">{{ e }}</fh-alert> }

      @if (items() === null) {
        <fh-spinner [showLabel]="true" />
      } @else {
        <!-- Month grid (tablets and larger) -->
        <div class="card hidden overflow-hidden md:block" role="grid" [attr.aria-label]="monthLabel()">
          <div class="grid grid-cols-7 border-b border-stone-200 bg-stone-50 text-center text-xs font-semibold uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:bg-stone-900" role="row">
            @for (d of weekdays; track d) { <div class="py-2" role="columnheader">{{ d }}</div> }
          </div>
          <div class="grid grid-cols-7">
            @for (day of days(); track day.key) {
              <button type="button" role="gridcell" class="flex min-h-28 min-w-0 flex-col items-stretch justify-start border-b border-r border-stone-200 p-1.5 text-left hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900" [class.opacity-50]="!day.inMonth" [class.ring-2]="selected() === day.key" [class.ring-inset]="selected() === day.key" [class.ring-brand-500]="selected() === day.key" (click)="selected.set(day.key)" [attr.aria-label]="dayLabel(day)">
                <span class="mb-1 inline-flex size-7 shrink-0 items-center justify-center self-start rounded-full text-sm" [class]="day.today ? 'bg-brand-700 font-semibold text-white' : 'text-stone-600 dark:text-stone-300'">{{ day.date }}</span>
                @for (i of day.items.slice(0, 3); track $index) {
                  <span class="mb-0.5 flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium" [class]="style[i.kind]">
                    <ng-container [ngTemplateOutlet]="icon" [ngTemplateOutletContext]="{ kind: i.kind }" />
                    <span class="truncate">{{ i.title }}</span>
                  </span>
                }
                @if (day.items.length > 3) { <span class="text-[11px] text-stone-500">{{ '+{count} more' | t: { count: day.items.length - 3 } }}</span> }
              </button>
            }
          </div>
        </div>

        <!-- Agenda: the selected day on larger screens, the whole month on phones -->
        <section class="mt-6" aria-labelledby="agenda-h">
          <h2 id="agenda-h" class="mb-3 text-lg font-semibold">
            <span class="md:hidden">{{ monthLabel() }}</span>
            <span class="hidden md:inline">{{ selectedLabel() }}</span>
          </h2>
          @for (group of agenda(); track group.key) {
            <div [class]="group.key !== selected() ? 'mb-4 md:hidden' : 'mb-4'">
              <h3 class="mb-2 text-sm font-semibold text-stone-500 md:hidden">{{ longDay(group.key) }}</h3>
              <ul class="space-y-2">
                @for (i of group.items; track $index) {
                  <li class="card flex items-center gap-3 p-3">
                    <span class="flex size-9 shrink-0 items-center justify-center rounded-full" [class]="style[i.kind]" [attr.aria-label]="labels[i.kind] | t">
                      <ng-container [ngTemplateOutlet]="icon" [ngTemplateOutletContext]="{ kind: i.kind, big: true }" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <p class="font-medium">{{ i.title }}</p>
                      @if (i.place) { <p class="text-sm text-stone-500">{{ i.place }}</p> }
                    </div>
                    <div class="flex -space-x-2">
                      @for (p of i.people.slice(0, 3); track p.id) {
                        <a [routerLink]="['/members', p.id]" [attr.aria-label]="p.displayName" class="rounded-full ring-2 ring-white dark:ring-stone-900"><fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" /></a>
                      }
                    </div>
                  </li>
                }
              </ul>
            </div>
          } @empty {
            <div class="card p-5 text-sm text-stone-500">
              <p>{{ "Nothing this month. Days appear here when people's dates of birth, death or marriage are recorded with the day and month." | t }}</p>
              <a routerLink="/members" class="mt-3 inline-block font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'Add dates to people’s profiles' | t }}</a>
            </div>
          }
          @if (agenda().length && !selectedItems().length) {
            <p class="hidden text-sm text-stone-500 md:block">{{ 'Nothing on this day. Choose another day in the calendar.' | t }}</p>
          }
        </section>
      }
    }

    <ng-template #icon let-kind="kind" let-big="big">
      @switch (kind) {
        @case ('birthday') { <svg lucideCake [class]="big ? 'size-4' : 'size-3 shrink-0'" aria-hidden="true"></svg> }
        @case ('anniversary') { <svg lucideHeart [class]="big ? 'size-4' : 'size-3 shrink-0'" aria-hidden="true"></svg> }
        @case ('remembrance') { <svg lucideFlower2 [class]="big ? 'size-4' : 'size-3 shrink-0'" aria-hidden="true"></svg> }
        @case ('birth_remembrance') { <svg lucideFlower [class]="big ? 'size-4' : 'size-3 shrink-0'" aria-hidden="true"></svg> }
        @default { <svg lucideCalendarDays [class]="big ? 'size-4' : 'size-3 shrink-0'" aria-hidden="true"></svg> }
      }
    </ng-template>
  `,
})
export class CalendarPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(CalendarApi);

  protected readonly kinds = CALENDAR_KINDS;
  protected readonly labels = CALENDAR_KIND_LABELS;
  protected readonly style = KIND_STYLE;
  /** Short weekday names, Monday first (5 January 2026 was a Monday). */
  protected readonly weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 5 + i).toLocaleDateString(dateLocale(), { weekday: 'short' }));
  protected readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  protected readonly selected = signal(dayKey(new Date()));
  protected readonly items = signal<CalendarItem[] | null>(null);
  protected readonly shown = signal(new Set<CalendarKind>(CALENDAR_KINDS));
  protected readonly error = signal<string | null>(null);

  /** The six weeks shown for the month, Monday first. */
  private readonly range = computed(() => {
    const first = this.month();
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 41);
    return { start, end };
  });

  private readonly visible = computed(() => (this.items() ?? []).filter((i) => this.shown().has(i.kind)));

  protected readonly days = computed<Day[]>(() => {
    const { start } = this.range();
    const byDay = new Map<string, CalendarItem[]>();
    for (const i of this.visible()) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
    const today = dayKey(new Date());
    return Array.from({ length: 42 }, (_, n) => {
      const d = new Date(start);
      d.setDate(start.getDate() + n);
      const key = dayKey(d);
      return { key, date: d.getDate(), inMonth: d.getMonth() === this.month().getMonth(), today: key === today, items: byDay.get(key) ?? [] };
    });
  });

  protected readonly agenda = computed(() => this.days().filter((d) => d.items.length && (d.inMonth || d.key === this.selected())).map((d) => ({ key: d.key, items: d.items })));
  protected readonly selectedItems = computed(() => this.days().find((d) => d.key === this.selected())?.items ?? []);
  protected readonly monthLabel = computed(() => this.month().toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }));
  protected readonly selectedLabel = computed(() => this.longDay(this.selected()));

  constructor() {
    effect(() => {
      const family = this.context.active();
      const { start, end } = this.range();
      if (family) untracked(() => void this.load(family.id, dayKey(start), dayKey(end)));
    });
  }

  private async load(familyId: string, from: string, to: string): Promise<void> {
    this.error.set(null);
    try {
      this.items.set(await this.api.calendar(familyId, from, to));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      this.items.set([]);
    }
  }

  protected longDay(key: string): string {
    return fromKey(key).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  }

  protected dayLabel(day: Day): string {
    const n = day.items.length;
    const date = this.longDay(day.key);
    return n ? t('{date}, {count, plural, one {# item} other {# items}}', { date, count: n }) : date;
  }

  protected move(delta: number): void {
    const m = this.month();
    const next = new Date(m.getFullYear(), m.getMonth() + delta, 1);
    this.month.set(next);
    this.selected.set(dayKey(next));
  }

  protected goToday(): void {
    const now = new Date();
    this.month.set(new Date(now.getFullYear(), now.getMonth(), 1));
    this.selected.set(dayKey(now));
  }

  protected toggle(kind: CalendarKind): void {
    this.shown.update((s) => {
      const next = new Set(s);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }
}
