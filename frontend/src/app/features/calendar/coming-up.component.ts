import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideCake, LucideCalendarDays, LucideFlower, LucideFlower2, LucideHeart } from '@lucide/angular';
import { CALENDAR_KIND_LABELS, type CalendarItem } from '@fh/contracts';
import { CalendarApi } from '../../core/calendar/calendar.api';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { KIND_STYLE, dateLocale } from './calendar.page';

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The next few calendar days, for the dashboard. Hidden when nothing is coming up. */
@Component({
  selector: 'fh-coming-up',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideCake, LucideCalendarDays, LucideFlower, LucideFlower2, LucideHeart, TranslatePipe],
  template: `
    @if (items()?.length) {
      <section class="card mb-6 p-5" aria-labelledby="coming-h">
        <div class="flex items-baseline justify-between gap-2">
          <h2 id="coming-h" class="text-lg font-semibold">{{ 'Coming up' | t }}</h2>
          <a routerLink="/calendar" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'Calendar' | t }}</a>
        </div>
        <ul class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          @for (i of items()!.slice(0, 6); track $index) {
            <li class="flex items-center gap-3 rounded-xl p-1.5">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-full" [class]="style[i.kind]" [attr.aria-label]="labels[i.kind] | t">
                @switch (i.kind) {
                  @case ('birthday') { <svg lucideCake class="size-4" aria-hidden="true"></svg> }
                  @case ('anniversary') { <svg lucideHeart class="size-4" aria-hidden="true"></svg> }
                  @case ('remembrance') { <svg lucideFlower2 class="size-4" aria-hidden="true"></svg> }
                  @case ('birth_remembrance') { <svg lucideFlower class="size-4" aria-hidden="true"></svg> }
                  @default { <svg lucideCalendarDays class="size-4" aria-hidden="true"></svg> }
                }
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium">{{ i.title }}</span>
                <span class="block text-xs text-stone-500">{{ when(i.date) }}</span>
              </span>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class ComingUpComponent {
  readonly familyId = input.required<string>();
  private readonly api = inject(CalendarApi);
  protected readonly items = signal<CalendarItem[] | null>(null);
  protected readonly style = KIND_STYLE;
  protected readonly labels = CALENDAR_KIND_LABELS;

  constructor() {
    effect(() => {
      const id = this.familyId();
      untracked(async () => {
        const today = new Date();
        const end = new Date(today);
        end.setDate(today.getDate() + 30);
        this.items.set(await this.api.calendar(id, dayKey(today), dayKey(end)).catch(() => []));
      });
    });
  }

  protected when(day: string): string {
    const today = dayKey(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (day === today) return t('Today');
    if (day === dayKey(tomorrow)) return t('Tomorrow');
    return new Date(`${day}T12:00:00`).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  }
}
