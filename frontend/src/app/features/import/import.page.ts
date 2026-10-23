import { Dialog } from '@angular/cdk/dialog';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideFileUp, LucideTriangleAlert, LucideUndo2 } from '@lucide/angular';
import { GEDCOM_MAX_MB, type GedcomImportPreview, type ImportBatchView, type ImportPersonPreview } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { DataToolsApi } from '../../core/data-tools/data-tools.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ConfirmDialogComponent, type ConfirmData } from '../../shared/ui/confirm-dialog.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { currentLanguage, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type Step = 'choose' | 'reading' | 'review' | 'importing' | 'done';

/** Import people from a GEDCOM file: preview, match with people already in the family, import, undo. */
@Component({
  selector: 'fh-import-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, AlertComponent, NoFamilyComponent, PersonAvatarComponent, SpinnerComponent, LucideFileUp, LucideTriangleAlert, LucideUndo2, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (!context.can('family.import')) {
      <fh-alert tone="info">{{ "Only the family's administrators can import files." | t }}</fh-alert>
    } @else {
      <header class="mb-6">
        <h1 class="text-3xl font-semibold">{{ 'Import from another program' | t }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-stone-500">
          {{ 'Bring people in from a' | t }} <strong>{{ 'GEDCOM file' | t }}</strong> {{ '(.ged): the format Ancestry, MyHeritage, FamilySearch, Gramps, Family Tree Maker and most genealogy programs can export.' | t }}
          {{ 'Nothing is added until you have checked the preview, and a whole import can be undone.' | t }}
        </p>
        @if (context.can('member.merge')) {
          <p class="mt-2 text-sm"><a routerLink="/members/duplicates" class="font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'Find people recorded twice' | t }} →</a></p>
        }
      </header>

      @if (error(); as e) { <fh-alert class="mb-4 block">{{ e }}</fh-alert> }

      @switch (step()) {
        @case ('choose') {
          <section class="card p-6" aria-labelledby="choose-h">
            <h2 id="choose-h" class="text-lg font-semibold">1. {{ 'Choose the file' | t }}</h2>
            <label class="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 p-10 text-center hover:border-brand-500 dark:border-stone-700"
                   (dragover)="$event.preventDefault()" (drop)="$event.preventDefault(); pick($event.dataTransfer?.files?.[0])">
              <svg lucideFileUp class="size-8 text-brand-700 dark:text-brand-300" aria-hidden="true"></svg>
              <span class="font-medium">{{ 'Choose a .ged file, or drop it here' | t }}</span>
              <span class="text-sm text-stone-500">{{ 'Up to {max} MB. In your genealogy program look for “Export”, “Download GEDCOM” or “Save as GEDCOM”.' | t: { max: maxMb } }}</span>
              <input type="file" class="sr-only" accept=".ged,.gedcom,text/plain" [attr.aria-label]="'GEDCOM file' | t" (change)="pick($any($event.target).files?.[0]); $any($event.target).value = ''" />
            </label>
          </section>
        }
        @case ('reading') {
          <div class="card flex items-center gap-3 p-6"><fh-spinner /> {{ 'Reading {name}… {percent}%' | t: { name: file()?.name, percent: (progress() * 100 | number: '1.0-0') } }}</div>
        }
        @case ('importing') {
          <div class="card flex items-center gap-3 p-6"><fh-spinner /> {{ '{count, plural, other {Importing # people…}} This can take a minute for large files.' | t: { count: toCreate() } }}</div> <!-- i18n-ignore -->
        }
        @case ('review') {
          @if (preview(); as p) {
            <section class="card p-6" aria-labelledby="sum-h">
              <h2 id="sum-h" class="text-lg font-semibold">2. {{ 'Check what will be imported' | t }}</h2>
              <p class="mt-1 text-sm text-stone-500">
                {{ p.fileName }}@if (p.source.system) { · {{ 'from {system}' | t: { system: p.source.system } }} }@if (p.source.version) { · GEDCOM {{ p.source.version }} } · {{ p.source.charset }} <!-- i18n-ignore -->
              </p>
              <dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div class="rounded-xl bg-stone-100 p-3 dark:bg-stone-800"><dt class="text-xs uppercase tracking-wide text-stone-500">{{ 'People' | t }}</dt><dd class="text-2xl font-semibold">{{ p.counts.people | number }}</dd></div>
                <div class="rounded-xl bg-stone-100 p-3 dark:bg-stone-800"><dt class="text-xs uppercase tracking-wide text-stone-500">{{ 'Families' | t }}</dt><dd class="text-2xl font-semibold">{{ p.counts.families | number }}</dd></div>
                <div class="rounded-xl bg-stone-100 p-3 dark:bg-stone-800"><dt class="text-xs uppercase tracking-wide text-stone-500">{{ 'Parent links' | t }}</dt><dd class="text-2xl font-semibold">{{ p.counts.parentLinks | number }}</dd></div>
                <div class="rounded-xl bg-stone-100 p-3 dark:bg-stone-800"><dt class="text-xs uppercase tracking-wide text-stone-500">{{ 'Couples' | t }}</dt><dd class="text-2xl font-semibold">{{ p.counts.partnerships | number }}</dd></div>
              </dl>

              @if (p.warningCount) {
                <details class="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                  <summary class="flex cursor-pointer items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                    <svg lucideTriangleAlert class="size-4" aria-hidden="true"></svg> {{ '{count, plural, one {# thing to know about this file} other {# things to know about this file}}' | t: { count: p.warningCount } }} <!-- i18n-ignore -->
                  </summary>
                  <ul class="mt-2 list-disc space-y-1 pl-6 text-amber-950 dark:text-amber-100">
                    @for (w of p.warnings; track $index) { <li>@if (w.ref && nameOf(w.ref); as n) { <strong>{{ n }}:</strong> }{{ w.message }}</li> }
                    @if (p.warningCount > p.warnings.length) { <li>{{ '…and {count} more.' | t: { count: (p.warningCount - p.warnings.length | number) } }}</li> }
                  </ul>
                </details>
              }

              <details class="mt-4 text-sm">
                <summary class="cursor-pointer font-medium">{{ 'See the first people in the file' | t }}</summary>
                <ul class="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  @for (s of p.sample; track s.ref) { <li>{{ s.name }} <span class="text-stone-500">{{ dates(s) }}</span></li> }
                </ul>
              </details>
            </section>

            <section class="card mt-6 p-6" aria-labelledby="match-h">
              <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="match-h" class="text-lg font-semibold">3. {{ 'People who may already be in the family' | t }}</h2>
                  <p class="mt-1 max-w-3xl text-sm text-stone-500">
                    {{ 'When someone in the file is already in the family, choose “Same person”: they are not added twice, and their family links from the file join them.' | t }}
                  </p>
                </div>
                @if (p.matches.length) {
                  <div class="flex gap-2">
                    <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="setAll(true)">{{ 'All the same' | t }}</button>
                    <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="setAll(false)">{{ 'All different' | t }}</button>
                  </div>
                }
              </div>
              @if (!p.matches.length) {
                <p class="mt-4 text-sm text-stone-600 dark:text-stone-300">{{ 'Nobody in the file looks like someone already in the family. Everyone will be added as new.' | t }}</p>
              } @else {
                <ul class="mt-4 divide-y divide-stone-200 dark:divide-stone-800">
                  @for (m of p.matches; track m.person.ref) {
                    <li class="grid gap-3 py-4 md:grid-cols-[1fr_1fr_auto] md:items-center">
                      <div>
                        <p class="text-xs uppercase tracking-wide text-stone-500">{{ 'In the file' | t }}</p>
                        <p class="font-medium">{{ m.person.name }}</p>
                        <p class="text-sm text-stone-500">{{ dates(m.person) }}@if (m.person.birthPlace) { · {{ m.person.birthPlace }} }</p>
                      </div>
                      <div class="flex items-center gap-3">
                        <fh-person-avatar [name]="m.existing.displayName" [photoUrl]="m.existing.photoUrl" size="sm" />
                        <div class="min-w-0">
                          <p class="text-xs uppercase tracking-wide text-stone-500">{{ 'In the family' | t }}</p>
                          <a class="font-medium hover:underline" [routerLink]="['/members', m.existing.id]" target="_blank">{{ m.existing.displayName }}</a>
                          <p class="text-sm text-stone-500">{{ life(m.existing) }}</p>
                          <p class="mt-1 flex flex-wrap gap-1">
                            <span class="badge" [class]="m.strength === 'strong' ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'">{{ m.strength === 'strong' ? ('Likely match' | t) : ('Possible match' | t) }}</span>
                            @for (r of m.reasons; track r) { <span class="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">{{ r }}</span> }
                          </p>
                        </div>
                      </div>
                      <fieldset class="flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
                        <legend class="sr-only">{{ 'Is {name} the same person as {other}?' | t: { name: m.person.name, other: m.existing.displayName } }}</legend>
                        <label class="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium has-[:checked]:bg-white has-[:checked]:shadow-sm dark:has-[:checked]:bg-stone-950">
                          <input type="radio" class="sr-only" [name]="'m-' + m.person.ref" [checked]="same()[m.person.ref] === m.existing.id" (change)="choose(m.person.ref, m.existing.id)" /> {{ 'Same person' | t }}
                        </label>
                        <label class="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium has-[:checked]:bg-white has-[:checked]:shadow-sm dark:has-[:checked]:bg-stone-950">
                          <input type="radio" class="sr-only" [name]="'m-' + m.person.ref" [checked]="same()[m.person.ref] !== m.existing.id" (change)="choose(m.person.ref, null)" /> {{ 'Different' | t }}
                        </label>
                      </fieldset>
                    </li>
                  }
                </ul>
              }
            </section>

            <section class="card mt-6 space-y-4 p-6" aria-labelledby="opt-h">
              <h2 id="opt-h" class="text-lg font-semibold">4. {{ 'Import' | t }}</h2>
              <label class="flex items-start gap-3 text-sm">
                <input type="checkbox" class="mt-1 accent-brand-700" [(ngModel)]="fillBlanks" />
                <span><strong>{{ 'Fill in missing details' | t }}</strong> {{ 'of people marked “Same person” from the file (dates, places, life story). Details already in the family are never replaced.' | t }}</span>
              </label>
              <label class="flex items-start gap-3 text-sm">
                <input type="checkbox" class="mt-1 accent-brand-700" [(ngModel)]="verifyLinks" />
                <span><strong>{{ "Treat the file's family links as checked." | t }}</strong> {{ 'Generations are worked out from checked links only; leave this off to review each imported link yourself first.' | t }}</span>
              </label>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn-primary" (click)="commit()">{{ '{count, plural, one {Import # person} other {Import # people}}' | t: { count: toCreate() } }}</button> <!-- i18n-ignore -->
                <button type="button" class="btn-secondary" (click)="reset()">{{ 'Choose another file' | t }}</button>
              </div>
            </section>
          }
        }
        @case ('done') {
          @if (result(); as r) {
            <fh-alert tone="success" class="block">
              {{ importedText(r) }}
            </fh-alert>
            <div class="mt-4 flex flex-wrap gap-2">
              <a routerLink="/tree" class="btn-primary">{{ 'See the family tree' | t }}</a>
              <a routerLink="/members/duplicates" class="btn-secondary">{{ 'Look for duplicates' | t }}</a>
              <button type="button" class="btn-secondary" (click)="reset()">{{ 'Import another file' | t }}</button>
            </div>
          }
        }
      }

      <section class="mt-10" aria-labelledby="past-h">
        <h2 id="past-h" class="text-lg font-semibold">{{ 'Earlier imports' | t }}</h2>
        @if (history() === null) {
          <fh-spinner class="mt-3" />
        } @else if (!history()!.length) {
          <p class="mt-2 text-sm text-stone-500">{{ 'No files have been imported into this family yet.' | t }}</p>
        } @else {
          <ul class="card mt-3 divide-y divide-stone-200 dark:divide-stone-800">
            @for (b of history(); track b.id) {
              <li class="flex flex-wrap items-center justify-between gap-3 p-4">
                <div class="min-w-0">
                  <p class="font-medium">{{ b.fileName }} @if (b.status === 'undone') { <span class="badge ml-1 bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200">{{ 'Undone' | t }}</span> }</p>
                  <p class="text-sm text-stone-500">
                    {{ b.createdAt | date: 'd MMM y, HH:mm' }}@if (b.createdBy) { · {{ b.createdBy }} }
                    · {{ '{count} added' | t: { count: (b.counts.created | number) } }}@if (b.counts.matched) { , {{ '{count} matched' | t: { count: (b.counts.matched | number) } }} }@if (b.source) { · {{ b.source }} }
                  </p>
                </div>
                @if (b.status === 'active') {
                  <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="undo(b)" [disabled]="busy()"><svg lucideUndo2 class="size-4"></svg> {{ 'Undo import' | t }}</button>
                }
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class ImportPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(DataToolsApi);
  private readonly dialog = inject(Dialog);

  protected readonly maxMb = GEDCOM_MAX_MB;
  protected readonly step = signal<Step>('choose');
  protected readonly file = signal<File | null>(null);
  protected readonly progress = signal(0);
  protected readonly preview = signal<GedcomImportPreview | null>(null);
  protected readonly same = signal<Record<string, string>>({});
  protected readonly result = signal<ImportBatchView | null>(null);
  protected readonly history = signal<ImportBatchView[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected fillBlanks = true;
  protected verifyLinks = true;

  protected readonly toCreate = computed(() => (this.preview()?.counts.people ?? 0) - Object.keys(this.same()).length);
  private readonly names = computed(() => new Map([...(this.preview()?.sample ?? []), ...(this.preview()?.matches.map((m) => m.person) ?? [])].map((p) => [p.ref, p.name])));

  constructor() {
    effect(() => {
      const family = this.context.active();
      if (family && this.context.can('family.import')) untracked(() => void this.loadHistory());
    });
  }

  protected nameOf(ref: string): string | undefined {
    return this.names().get(ref);
  }
  protected dates(p: ImportPersonPreview): string {
    const born = formatFuzzyDate(p.birthDate);
    const died = formatFuzzyDate(p.deathDate);
    return died ? `${born || '?'} – ${died}` : born ? t('b. {date}', { date: born }) : '';
  }
  protected readonly life = lifespan;

  protected importedText(r: ImportBatchView): string {
    const n = (v: number) => new Intl.NumberFormat(currentLanguage().formats).format(v);
    const params = { count: r.counts.created, links: n(r.counts.parentLinks), couples: n(r.counts.partnerships), matched: n(r.counts.matched) };
    return r.counts.matched
      ? t('{count, plural, one {Imported # person} other {Imported # people}}, {links} parent links and {couples} couples, joining {matched} people already in the family. Generations are being worked out now.', params)
      : t('{count, plural, one {Imported # person} other {Imported # people}}, {links} parent links and {couples} couples. Generations are being worked out now.', params);
  }

  private async loadHistory(): Promise<void> {
    try {
      this.history.set(await this.api.imports(this.context.active()!.id));
    } catch {
      this.history.set([]);
    }
  }

  protected async pick(file: File | undefined): Promise<void> {
    if (!file) return;
    this.error.set(null);
    if (file.size > GEDCOM_MAX_MB * 1024 * 1024) {
      this.error.set(t('This file is larger than {max} MB.', { max: GEDCOM_MAX_MB }));
      return;
    }
    this.file.set(file);
    this.progress.set(0);
    this.step.set('reading');
    try {
      const p = await this.api.previewGedcom(this.context.active()!.id, file, (f) => this.progress.set(f));
      this.preview.set(p);
      // Likely matches start as "same person"; possible ones as different.
      this.same.set(Object.fromEntries(p.matches.filter((m) => m.strength === 'strong').map((m) => [m.person.ref, m.existing.id])));
      this.step.set('review');
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      this.step.set('choose');
    }
  }

  protected choose(ref: string, memberId: string | null): void {
    this.same.update((s) => {
      const next = { ...s };
      if (memberId) {
        // One family member can be matched to only one person in the file.
        for (const [k, v] of Object.entries(next)) if (v === memberId) delete next[k];
        next[ref] = memberId;
      } else {
        delete next[ref];
      }
      return next;
    });
  }

  protected setAll(same: boolean): void {
    const matches = this.preview()?.matches ?? [];
    const next: Record<string, string> = {};
    const used = new Set<string>();
    if (same) for (const m of matches) if (!used.has(m.existing.id)) (next[m.person.ref] = m.existing.id), used.add(m.existing.id);
    this.same.set(next);
  }

  protected async commit(): Promise<void> {
    const file = this.file();
    if (!file) return;
    this.error.set(null);
    this.step.set('importing');
    try {
      this.result.set(await this.api.importGedcom(this.context.active()!.id, file, { same: this.same(), fillBlanks: this.fillBlanks, verifyLinks: this.verifyLinks }));
      this.step.set('done');
      await Promise.all([this.loadHistory(), this.context.load()]);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      this.step.set('review');
    }
  }

  protected reset(): void {
    this.step.set('choose');
    this.preview.set(null);
    this.file.set(null);
    this.same.set({});
    this.result.set(null);
    this.error.set(null);
  }

  protected async undo(b: ImportBatchView): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog.open<boolean, ConfirmData>(ConfirmDialogComponent, {
        data: {
          title: t('Undo the import of {name}?', { name: b.fileName }),
          message: t(
            '{count, plural, other {The {count} people it added and every link it added are removed (they can be brought back one by one from the change history).}} Details it filled in are put back unless they have been changed since.',
            { count: b.counts.created },
          ),
          confirmLabel: t('Undo import'),
          danger: true,
        },
        role: 'alertdialog',
      }).closed,
    );
    if (!ok) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.undoImport(this.context.active()!.id, b.id);
      await Promise.all([this.loadHistory(), this.context.load()]);
      if (this.result()?.id === b.id) this.reset();
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
