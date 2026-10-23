import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideBookOpen, LucideCalendarDays, LucideDynamicIcon, LucideFeather, LucideMapPin } from '@lucide/angular';
import { canPropose, STORY_KIND_LABELS, STORY_KINDS, type PersonCard, type StoryKind, type StoryView, type TimelineItem } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { EventDialogComponent, type EventDialogData } from './event-dialog.component';
import { TIMELINE_ICONS, timelineKindLabel } from './timeline-kinds';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type Tab = 'timeline' | 'stories';
type Include = 'events' | 'stories' | 'records';

interface Decade {
  label: string;
  items: TimelineItem[];
}

@Component({
  selector: 'fh-family-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, SpinnerComponent, NoFamilyComponent, PersonAvatarComponent, PersonPickerComponent, LucideDynamicIcon, LucideFeather, LucideCalendarDays, LucideMapPin, LucideBookOpen, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Family history' | t }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ 'The story of the {name}: events, oral histories, traditions and memories, alongside the births, marriages and deaths in the family record.' | t: { name: context.active()!.name } }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          @if (canWrite()) {
            <a routerLink="/history/stories/new" class="btn-primary"><svg lucideFeather class="size-4"></svg> {{ 'Write a story' | t }}</a>
          }
          @if (context.can('event.manage')) {
            <button type="button" class="btn-secondary" (click)="openEvent(null)"><svg lucideCalendarDays class="size-4"></svg> {{ 'Add an event' | t }}</button>
          }
        </div>
      </header>

      <div role="tablist" [attr.aria-label]="'Family history' | t" class="mb-6 flex gap-1 border-b border-stone-200 dark:border-stone-800">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [attr.aria-selected]="activeTab() === t.id" class="-mb-px border-b-2 px-4 py-2 text-sm font-medium" [class]="activeTab() === t.id ? 'border-brand-700 text-brand-800 dark:border-brand-300 dark:text-brand-200' : 'border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'" (click)="setTab(t.id)">{{ t.label }}</button>
        }
      </div>

      @if (notice(); as n) { <fh-alert tone="success" class="mb-4">{{ n }}</fh-alert> }
      @if (error(); as e) { <fh-alert class="mb-4">{{ e }}</fh-alert> }

      @if (activeTab() === 'timeline') {
        <div class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end">
          <fieldset class="flex flex-wrap gap-2">
            <legend class="label">{{ 'Show' | t }}</legend>
            @for (o of includeOptions; track o.id) {
              <label class="flex cursor-pointer items-center gap-2 rounded-xl border border-stone-300 px-3 py-1.5 text-sm has-checked:border-brand-600 has-checked:bg-brand-50 dark:border-stone-700 dark:has-checked:bg-brand-950">
                <input type="checkbox" class="accent-brand-700" [checked]="include().includes(o.id)" (change)="toggle(o.id)" /> {{ o.label }}
              </label>
            }
          </fieldset>
          <div class="lg:w-72">
            <fh-person-picker [familyId]="context.active()!.id" [label]="'About one person' | t" [value]="person()" (picked)="setPerson($event)" />
          </div>
        </div>

        @if (timeline() === null) {
          <fh-spinner [showLabel]="true" />
        } @else if (!decades().length) {
          <div class="card p-10 text-center">
            <p class="font-medium">{{ 'Nothing dated to show yet.' | t }}</p>
            <p class="mt-1 text-sm text-stone-500">{{ 'Births, marriages and deaths appear here once people have dates; events and stories once they are dated.' | t }}</p>
          </div>
        } @else {
          @if (decades().length > 3) {
            <nav [attr.aria-label]="'Jump to decade' | t" class="mb-4 flex flex-wrap gap-1.5">
              @for (d of decades(); track d.label) { <a [href]="'#d-' + d.label" class="rounded-lg bg-stone-100 px-2 py-1 text-xs font-medium hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700" (click)="jump($event, d.label)">{{ d.label }}</a> }
            </nav>
          }
          @if (truncated()) { <fh-alert tone="info" class="mb-4">{{ 'The timeline is long; only the first 2 000 entries are shown. Choose a person to narrow it.' | t }}</fh-alert> }
          <div class="space-y-8">
            @for (d of decades(); track d.label) {
              <section [id]="'d-' + d.label" [attr.aria-labelledby]="'dh-' + d.label" class="scroll-mt-20">
                <h2 [id]="'dh-' + d.label" class="mb-3 font-serif text-2xl font-semibold text-brand-900 dark:text-brand-200">{{ d.label }}</h2>
                <ol class="relative space-y-3 border-l-2 border-brand-200 pl-6 dark:border-brand-900">
                  @for (t of d.items; track t.key) {
                    <li class="relative">
                      <span class="absolute -left-[33px] top-3 flex size-4 items-center justify-center rounded-full ring-4 ring-stone-50 dark:ring-stone-950" [class]="dot(t)" aria-hidden="true"></span>
                      <button type="button" class="card flex w-full items-start gap-4 p-4 text-left transition hover:shadow-(--shadow-raised)" (click)="openItem(t)">
                        <div class="min-w-0 flex-1">
                          <p class="flex flex-wrap items-center gap-x-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                            <svg [lucideIcon]="icon(t)" class="size-3.5" aria-hidden="true"></svg>{{ kindLabel(t) }} · {{ fuzzy(t) }}
                          </p>
                          <p class="mt-1 font-medium">{{ t.title }}</p>
                          @if (t.place) { <p class="mt-0.5 flex items-center gap-1 text-sm text-stone-500"><svg lucideMapPin class="size-3.5" aria-hidden="true"></svg>{{ t.place }}</p> }
                          @if (t.people.length && t.source !== 'record') {
                            <p class="mt-2 flex -space-x-2">
                              @for (p of t.people.slice(0, 6); track p.id) { <fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" class="ring-2 ring-white dark:ring-stone-900" /> }
                            </p>
                          }
                        </div>
                        @if (t.thumbUrl) { <img [src]="t.thumbUrl" alt="" loading="lazy" class="size-16 shrink-0 rounded-lg object-cover" /> }
                      </button>
                    </li>
                  }
                </ol>
              </section>
            }
          </div>
        }
      } @else {
        <div class="mb-5 flex flex-wrap items-end gap-3">
          <div>
            <label class="label" for="story-kind">{{ 'Kind' | t }}</label>
            <select id="story-kind" class="input" [value]="storyKind()" (change)="setStoryKind($any($event.target).value)">
              <option value="">{{ 'All kinds' | t }}</option>
              @for (k of storyKinds; track k) { <option [value]="k">{{ storyKindLabels[k] | t }}</option> }
            </select>
          </div>
          <div class="flex-1 sm:max-w-xs">
            <label class="label" for="story-q">{{ 'Search' | t }}</label>
            <input id="story-q" class="input" type="search" [value]="storyQ()" (input)="onStorySearch($any($event.target).value)" [placeholder]="'Words in the title or story' | t" />
          </div>
        </div>
        @if (stories() === null) {
          <fh-spinner [showLabel]="true" />
        } @else if (!stories()!.length) {
          <div class="card p-10 text-center">
            <p class="font-medium">{{ 'No stories yet.' | t }}</p>
            @if (canWrite()) { <p class="mt-1 text-sm text-stone-500">{{ 'Record what the elders remember: how the family came to its hometown, its traditions, the people who shaped it.' | t }}</p> }
          </div>
        } @else {
          <ul class="grid gap-4 md:grid-cols-2">
            @for (s of stories(); track s.id) {
              <li>
                <a [routerLink]="['/history/stories', s.id]" class="card flex h-full flex-col gap-2 p-5 transition hover:shadow-(--shadow-raised)">
                  <p class="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                    <svg lucideBookOpen class="size-3.5" aria-hidden="true"></svg>{{ storyKindLabels[s.kind] | t }}
                    @if (s.date) { · {{ fuzzyDate(s.date) }} }
                    @if (s.status !== 'published') { <span class="badge bg-gold-100 text-gold-700 normal-case">{{ s.status === 'pending_approval' ? ('In review' | t) : ('Not accepted' | t) }}</span> }
                    @if (s.recording) { <span class="badge bg-brand-50 text-brand-800 normal-case dark:bg-brand-950 dark:text-brand-200">{{ 'Recording' | t }}</span> }
                  </p>
                  <h2 class="font-serif text-xl font-semibold">{{ s.title }}</h2>
                  <p class="line-clamp-3 text-sm text-stone-600 dark:text-stone-300">{{ s.body }}</p>
                  <p class="mt-auto pt-2 text-xs text-stone-500">@if (s.narrator) { {{ 'Told by {name}' | t: { name: s.narrator } }} } @else if (s.createdBy) { {{ 'Written by {name}' | t: { name: s.createdBy.displayName } }} }</p>
                </a>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class FamilyHistoryPage {
  /** Query parameters: `tab` and `member` (show one person's history). */
  readonly tab = input<string>();
  readonly member = input<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly archive = inject(ArchiveApi);
  private readonly membersApi = inject(MembersApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'timeline', label: t('Timeline') },
    { id: 'stories', label: t('Stories & traditions') },
  ];
  protected readonly includeOptions: { id: Include; label: string }[] = [
    { id: 'events', label: t('Events') },
    { id: 'stories', label: t('Stories') },
    { id: 'records', label: t('Births, marriages, deaths') },
  ];
  protected readonly storyKinds = STORY_KINDS;
  protected readonly storyKindLabels = STORY_KIND_LABELS;
  protected readonly fuzzyDate = formatFuzzyDate;

  protected readonly activeTab = signal<Tab>('timeline');
  protected readonly include = signal<Include[]>(['events', 'stories', 'records']);
  protected readonly person = signal<PersonCard | null>(null);
  protected readonly timeline = signal<TimelineItem[] | null>(null);
  protected readonly truncated = signal(false);
  protected readonly stories = signal<StoryView[] | null>(null);
  protected readonly storyKind = signal<StoryKind | ''>('');
  protected readonly storyQ = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly canWrite = computed(() => {
    const f = this.context.active();
    return !!f && canPropose({ role: f.role }, 'story.create');
  });

  protected readonly decades = computed<Decade[]>(() => {
    const groups = new Map<number, TimelineItem[]>();
    for (const item of this.timeline() ?? []) {
      const year = item.date.year;
      if (year == null) continue;
      const decade = Math.floor(year / 10) * 10;
      groups.set(decade, [...(groups.get(decade) ?? []), item]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([d, items]) => ({ label: `${d}s`, items }));
  });

  constructor() {
    effect(() => {
      const family = this.context.active();
      const tab = this.tab() === 'stories' ? 'stories' : 'timeline';
      const memberId = this.member();
      if (!family) return;
      untracked(async () => {
        this.activeTab.set(tab);
        if (memberId && this.person()?.id !== memberId) this.person.set(await this.membersApi.get(family.id, memberId).catch(() => null));
        await this.reload();
      });
    });
  }

  protected setTab(tab: Tab): void {
    void this.router.navigate([], { queryParams: { tab: tab === 'timeline' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  private reload(): Promise<void> {
    return this.activeTab() === 'timeline' ? this.loadTimeline() : this.loadStories();
  }

  private async loadTimeline(): Promise<void> {
    const family = this.context.active()!;
    this.error.set(null);
    try {
      const res = await this.archive.timeline(family.id, { memberId: this.person()?.id, include: this.include() });
      this.timeline.set(res.data);
      this.truncated.set(res.meta.truncated);
    } catch (err) {
      this.timeline.set([]);
      this.error.set(ApiError.from(err).message);
    }
  }

  private async loadStories(): Promise<void> {
    const family = this.context.active()!;
    this.error.set(null);
    try {
      this.stories.set((await this.archive.stories(family.id, { kind: this.storyKind() || undefined, q: this.storyQ().trim() || undefined, pageSize: 100 })).data);
    } catch (err) {
      this.stories.set([]);
      this.error.set(ApiError.from(err).message);
    }
  }

  protected toggle(id: Include): void {
    const now = this.include();
    const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
    this.include.set(next.length ? next : now);
    void this.loadTimeline();
  }

  protected setPerson(p: PersonCard | null): void {
    this.person.set(p);
    void this.router.navigate([], { queryParams: { member: p?.id ?? null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected setStoryKind(kind: string): void {
    this.storyKind.set(kind as StoryKind | '');
    void this.loadStories();
  }

  protected onStorySearch(value: string): void {
    this.storyQ.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadStories(), 300);
  }

  protected jump(event: Event, label: string): void {
    event.preventDefault();
    document.getElementById(`d-${label}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected icon(item: TimelineItem) {
    return TIMELINE_ICONS[item.kind] ?? TIMELINE_ICONS.other;
  }

  protected kindLabel(item: TimelineItem): string {
    return timelineKindLabel(item);
  }

  protected fuzzy(item: TimelineItem): string {
    return formatFuzzyDate(item.date);
  }

  protected dot(item: TimelineItem): string {
    return item.source === 'event' ? 'bg-gold-500' : item.source === 'story' ? 'bg-brand-500' : 'bg-stone-400';
  }

  protected async openItem(item: TimelineItem): Promise<void> {
    if (item.source === 'story' && item.storyId) {
      await this.router.navigate(['/history/stories', item.storyId]);
    } else if (item.source === 'event' && item.eventId) {
      await this.openEvent(item.eventId);
    } else if (item.people[0]) {
      await this.router.navigate(['/members', item.people[0].id]);
    }
  }

  protected async openEvent(eventId: string | null): Promise<void> {
    const ref = this.dialog.open<string, EventDialogData>(EventDialogComponent, { data: { familyId: this.context.active()!.id, eventId } });
    const result = await firstValueFrom(ref.closed);
    if (result) {
      this.notice.set(result);
      await this.loadTimeline();
    }
  }
}
