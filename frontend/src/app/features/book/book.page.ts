import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideBookOpen, LucideDownload, LucideTrash2 } from '@lucide/angular';
import { BOOK_LABELS, type BookLabels, type BookOptions, type BookScope, type BookView, type BranchView, type PaperSize, type PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { BookApi } from '../../core/book/book.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { currentLanguage, mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TreeApi } from '../../core/tree/tree.api';
import { formatBytes } from '../../shared/archive-format';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

type Part = keyof BookOptions['include'];
const POLL_MS = 3000;

/** Make a printable PDF book of the family, a branch or one person's family, and download it. */
@Component({
  selector: 'fh-book-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, TranslatePipe, AlertComponent, NoFamilyComponent, PersonPickerComponent, SpinnerComponent, LucideBookOpen, LucideDownload, LucideTrash2],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6">
        <h1 class="text-3xl font-semibold">{{ 'Family book' | t }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-stone-500">{{ 'A book to print or share: a cover, the family tree, a page for each person with their photo, dates and stories, the timeline and photographs, and an index of names. It holds what you can see, in your language.' | t }}</p>
      </header>
      @if (error(); as e) { <fh-alert class="mb-4 block">{{ e }}</fh-alert> }

      <div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <form class="card space-y-5 p-6" (ngSubmit)="make()" aria-labelledby="make-h">
          <h2 id="make-h" class="text-lg font-semibold">{{ 'Make a book' | t }}</h2>
          <fieldset>
            <legend class="label">{{ 'Who is in it' | t }}</legend>
            <div class="mt-1 space-y-2">
              <label class="flex items-center gap-2"><input type="radio" name="scope" value="family" [(ngModel)]="scope" /> {{ 'The whole family' | t }}</label>
              <label class="flex items-center gap-2"><input type="radio" name="scope" value="branch" [(ngModel)]="scope" [disabled]="!branches().length" /> {{ 'A branch' | t }}@if (!branches().length) { <span class="text-sm text-stone-500">{{ '(no branches yet)' | t }}</span> }</label>
              <label class="flex items-center gap-2"><input type="radio" name="scope" value="person" [(ngModel)]="scope" /> {{ "One person's family: their ancestors and descendants" | t }}</label>
            </div>
          </fieldset>
          @if (scope === 'branch') {
            <div>
              <label class="label" for="bk-branch">{{ 'Branch' | t }}</label>
              <select id="bk-branch" name="branch" class="input" [(ngModel)]="branchId" required>
                @for (b of branches(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
              </select>
            </div>
          }
          @if (scope === 'person') {
            <fh-person-picker [familyId]="context.active()!.id" [label]="'Person' | t" (picked)="person.set($event)" />
            <div>
              <label class="label" for="bk-gens">{{ 'Generations up and down' | t }}</label>
              <select id="bk-gens" name="gens" class="input !w-auto" [(ngModel)]="generations">
                @for (n of [1, 2, 3, 4, 5, 6, 8, 10]; track n) { <option [ngValue]="n">{{ n }}</option> }
              </select>
            </div>
          }
          <div class="grid gap-4 sm:grid-cols-2">
            <div><label class="label" for="bk-title">{{ 'Title' | t }} <span class="font-normal text-stone-500">{{ '(optional)' | t }}</span></label><input id="bk-title" name="title" class="input" maxlength="120" [(ngModel)]="title" [placeholder]="context.active()!.name" /></div>
            <div><label class="label" for="bk-sub">{{ 'Subtitle' | t }} <span class="font-normal text-stone-500">{{ '(optional)' | t }}</span></label><input id="bk-sub" name="subtitle" class="input" maxlength="200" [(ngModel)]="subtitle" [placeholder]="'The descendants of …' | t" /></div>
          </div>
          <fieldset>
            <legend class="label">{{ 'What goes in' | t }}</legend>
            <div class="mt-1 grid gap-2 sm:grid-cols-2">
              @for (p of parts; track p.key) {
                <label class="flex items-center gap-2"><input type="checkbox" [name]="p.key" [(ngModel)]="include[p.key]" /> {{ p.label | t }}</label>
              }
            </div>
          </fieldset>
          <fieldset>
            <legend class="label">{{ 'Living people' | t }}</legend>
            <div class="mt-1 space-y-2">
              <label class="flex items-start gap-2"><input type="radio" name="living" value="names" class="mt-1" [(ngModel)]="living" /> <span>{{ 'Names only' | t }} <span class="block text-sm text-stone-500">{{ 'Recommended for a book that will be printed and passed around.' | t }}</span></span></label>
              <label class="flex items-start gap-2"><input type="radio" name="living" value="full" class="mt-1" [(ngModel)]="living" /> <span>{{ 'Everything I can see' | t }}</span></label>
            </div>
          </fieldset>
          <div>
            <label class="label" for="bk-paper">{{ 'Paper' | t }}</label>
            <select id="bk-paper" name="paper" class="input !w-auto" [(ngModel)]="paper">
              <option value="A4">A4</option><!-- i18n-ignore -->
              <option value="LETTER">{{ 'US Letter' | t }}</option>
            </select>
          </div>
          <button type="submit" class="btn-primary" [disabled]="busy()"><svg lucideBookOpen class="size-4"></svg> {{ 'Make the book' | t }}</button>
        </form>

        <section class="card p-6" aria-labelledby="mine-h">
          <h2 id="mine-h" class="text-lg font-semibold">{{ 'Your books' | t }}</h2>
          @if (books() === null) {
            <fh-spinner class="mt-4" />
          } @else if (!books()!.length) {
            <p class="mt-2 text-sm text-stone-500">{{ 'None yet. Books you make appear here for you to download; nobody else sees them.' | t }}</p>
          } @else {
            <ul class="mt-3 divide-y divide-stone-200 dark:divide-stone-800">
              @for (b of books(); track b.id) {
                <li class="py-3">
                  <p class="font-medium">{{ b.title }}</p>
                  <p class="text-xs text-stone-500">{{ scopeLabel(b.options.scope) | t }} · {{ b.createdAt | date: 'medium' }}</p>
                  @switch (b.status) {
                    @case ('done') {
                      <p class="mt-1 text-sm text-stone-600 dark:text-stone-300">{{ '{pages, plural, one {# page} other {# pages}}' | t: { pages: b.pages } }} · {{ '{people, plural, one {# person} other {# people}}' | t: { people: b.people } }} · {{ size(b.sizeBytes) }}</p>
                      <div class="mt-2 flex gap-2">
                        <a class="btn-primary !py-1.5 text-sm" [href]="b.downloadUrl" download><svg lucideDownload class="size-4"></svg> {{ 'Download PDF' | t }}</a>
                        <button type="button" class="btn-ghost !py-1.5 text-sm text-red-700 dark:text-red-400" (click)="remove(b)" [attr.aria-label]="'Remove {title}' | t: { title: b.title }"><svg lucideTrash2 class="size-4"></svg></button>
                      </div>
                    }
                    @case ('failed') {
                      <p class="mt-1 text-sm text-red-700 dark:text-red-400" role="status">{{ 'The book could not be made: {error}' | t: { error: b.error } }}</p>
                      <button type="button" class="btn-ghost mt-1 !py-1 text-sm" (click)="remove(b)">{{ 'Remove' | t }}</button>
                    }
                    @default {
                      <div class="mt-2" role="status">
                        <p class="text-sm text-stone-600 dark:text-stone-300">@if (b.status === 'queued') { {{ 'Waiting to start…' | t }} } @else { {{ 'Making the book… {progress}%' | t: { progress: b.progress } }} }</p>
                        <div class="mt-1 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" role="progressbar" [attr.aria-valuenow]="b.progress" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Progress' | t">
                          <div class="h-full rounded-full bg-brand-600 transition-all" [style.width.%]="b.progress"></div>
                        </div>
                      </div>
                    }
                  }
                </li>
              }
            </ul>
          }
        </section>
      </div>
    }
  `,
})
export class BookPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(BookApi);
  private readonly tree = inject(TreeApi);

  protected readonly books = signal<BookView[] | null>(null);
  protected readonly branches = signal<BranchView[]>([]);
  protected readonly person = signal<PersonCard | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly parts: { key: Part; label: string }[] = [
    { key: 'tree', label: BOOK_LABELS.familyTree },
    { key: 'people', label: mark('A page for each person') },
    { key: 'stories', label: BOOK_LABELS.stories },
    { key: 'timeline', label: BOOK_LABELS.timeline },
    { key: 'photos', label: BOOK_LABELS.photos },
  ];
  protected readonly size = (n: number | null) => (n ? formatBytes(n) : '');
  protected scope: BookScope = 'family';
  protected branchId = '';
  protected generations = 3;
  protected title = '';
  protected subtitle = '';
  protected include: BookOptions['include'] = { tree: true, people: true, stories: true, timeline: true, photos: true };
  protected living: BookOptions['living'] = 'names';
  protected paper: PaperSize = currentLanguage().code === 'en' && navigator.language === 'en-US' ? 'LETTER' : 'A4';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const family = this.context.active();
      if (family) untracked(() => void this.load(family.id));
    });
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
  }

  private async load(familyId: string): Promise<void> {
    try {
      const [books, branches] = await Promise.all([this.api.list(familyId), this.tree.branches(familyId).catch(() => [] as BranchView[])]);
      this.books.set(books);
      this.branches.set(branches);
      if (!this.branchId && branches[0]) this.branchId = branches[0].id;
      this.pollIfBusy(familyId);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  private pollIfBusy(familyId: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.books()?.some((b) => b.status === 'queued' || b.status === 'running')) {
      this.timer = setTimeout(async () => {
        this.books.set(await this.api.list(familyId).catch(() => this.books()));
        this.pollIfBusy(familyId);
      }, POLL_MS);
    }
  }

  protected scopeLabel(scope: BookScope): string {
    return scope === 'family' ? mark('The whole family') : scope === 'branch' ? mark('A branch') : mark("One person's family: their ancestors and descendants");
  }

  /** The words printed in the book, in the language of the app, with their `{placeholders}` left for the server. */
  private labels(): BookLabels {
    const keep = (text: string) => Object.fromEntries([...text.matchAll(/\{(\w+)\}/g)].map(([whole, name]) => [name!, whole]));
    return Object.fromEntries(Object.entries(BOOK_LABELS).map(([k, v]) => [k, t(v, keep(v))])) as BookLabels;
  }

  protected async make(): Promise<void> {
    const familyId = this.context.active()!.id;
    if (this.scope === 'person' && !this.person()) return this.error.set(t('Choose the person the book is about.'));
    this.busy.set(true);
    this.error.set(null);
    try {
      const book = await this.api.create(familyId, {
        scope: this.scope,
        ...(this.scope === 'branch' ? { branchId: this.branchId } : {}),
        ...(this.scope === 'person' ? { personId: this.person()!.id, generations: this.generations } : {}),
        ...(this.title.trim() ? { title: this.title.trim() } : {}),
        ...(this.subtitle.trim() ? { subtitle: this.subtitle.trim() } : {}),
        include: this.include,
        living: this.living,
        paper: this.paper,
        locale: currentLanguage().code === 'en' ? 'en-GB' : currentLanguage().formats,
        labels: this.labels(),
      });
      this.books.update((list) => [book, ...(list ?? [])]);
      this.pollIfBusy(familyId);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(b: BookView): Promise<void> {
    try {
      await this.api.remove(this.context.active()!.id, b.id);
      this.books.update((list) => list?.filter((x) => x.id !== b.id) ?? null);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }
}
