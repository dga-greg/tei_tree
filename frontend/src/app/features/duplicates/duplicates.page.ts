import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideGitMerge, LucideUndo2 } from '@lucide/angular';
import type { DuplicatePair, MergeView, PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { DataToolsApi } from '../../core/data-tools/data-tools.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { generationLabel, lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { mark } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Why the server thinks two people may be the same (sent as English text; shown with `| t`). */
export const MATCH_REASONS = [
  mark('Same first name'),
  mark('First names sound alike'),
  mark('First name matches a middle name'),
  mark('First initial matches'),
  mark('Same surname'),
  mark('Surnames sound alike'),
  mark('Same date of birth'),
  mark('Born the same year'),
  mark('Born within two years'),
  mark('Died the same year'),
  mark('Same parent'),
];

/** People who may have been recorded twice, and recent merges (administrators). */
@Component({
  selector: 'fh-duplicates-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, AlertComponent, NoFamilyComponent, PersonAvatarComponent, SpinnerComponent, LucideGitMerge, LucideUndo2, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (!context.can('member.merge')) {
      <fh-alert tone="info">{{ "Only the family's administrators can merge people." | t }}</fh-alert>
    } @else {
      <header class="mb-6">
        <h1 class="text-3xl font-semibold">{{ 'Possible duplicates' | t }}</h1>
        <p class="mt-1 max-w-3xl text-sm text-stone-500">
          {{ 'People who may have been recorded twice: similar names (including spellings that sound alike), close dates and shared parents.' | t }}
          {{ 'Compare them side by side and merge them into one record, or tell us they are different people. Merges can be undone.' | t }}
        </p>
      </header>

      @if (error(); as e) { <fh-alert class="mb-4 block">{{ e }}</fh-alert> }

      @if (pairs() === null) {
        <fh-spinner [showLabel]="true" />
      } @else if (!pairs()!.length) {
        <div class="card p-10 text-center">
          <p class="font-medium">{{ 'No likely duplicates found.' | t }}</p>
          <p class="mt-1 text-sm text-stone-500">{{ 'To merge two particular people, open one of their profiles and choose “Merge with another record”.' | t }}</p>
        </div>
      } @else {
        <ul class="space-y-4">
          @for (p of pairs(); track p.a.id + p.b.id) {
            <li class="card p-5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="badge" [class]="p.strength === 'strong' ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100' : 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'">{{ (p.strength === 'strong' ? 'Likely the same' : 'Possibly the same') | t }}</span>
                @for (r of p.reasons; track r) { <span class="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">{{ r | t }}</span> }
              </div>
              <div class="mt-4 grid gap-4 sm:grid-cols-2">
                @for (person of [p.a, p.b]; track person.id) {
                  <a [routerLink]="['/members', person.id]" class="flex items-center gap-3 rounded-xl border border-stone-200 p-3 hover:border-brand-500 dark:border-stone-800">
                    <fh-person-avatar [name]="person.displayName" [photoUrl]="person.photoUrl" />
                    <span class="min-w-0">
                      <span class="block truncate font-medium">{{ person.displayName }}</span>
                      <span class="block text-sm text-stone-500">{{ describe(person) }}</span>
                    </span>
                  </a>
                }
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                <a class="btn-primary !py-1.5 text-sm" [routerLink]="['/members', p.a.id, 'merge']" [queryParams]="{ with: p.b.id }"><svg lucideGitMerge class="size-4"></svg> {{ 'Compare and merge' | t }}</a>
                <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="dismiss(p)" [disabled]="busy()">{{ 'Not the same person' | t }}</button>
              </div>
            </li>
          }
        </ul>
      }

      <section class="mt-10" aria-labelledby="merges-h">
        <h2 id="merges-h" class="text-lg font-semibold">{{ 'Recent merges' | t }}</h2>
        @if (merges() === null) {
          <fh-spinner class="mt-3" />
        } @else if (!merges()!.length) {
          <p class="mt-2 text-sm text-stone-500">{{ 'No one has been merged yet.' | t }}</p>
        } @else {
          <ul class="card mt-3 divide-y divide-stone-200 dark:divide-stone-800">
            @for (m of merges(); track m.id) {
              <li class="flex flex-wrap items-center justify-between gap-3 p-4">
                <div class="min-w-0">
                  <p class="font-medium">
                    {{ m.otherName }} → @if (m.keep) { <a class="hover:underline" [routerLink]="['/members', m.keep.id]">{{ m.keep.displayName }}</a> } @else { {{ '(removed)' | t }} }
                    @if (m.status === 'undone') { <span class="badge ml-1 bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200">{{ 'Undone' | t }}</span> }
                  </p>
                  <p class="text-sm text-stone-500">{{ m.createdAt | date: 'd MMM y, HH:mm' }}@if (m.createdBy) { · {{ m.createdBy }} } · {{ '{links, plural, one {# link moved} other {# links moved}}, {items, plural, one {# photo, story or event} other {# photos, stories or events}}' | t: { links: m.linksMoved, items: m.itemsMoved } }}</p> <!-- i18n-ignore -->
                </div>
                @if (m.status === 'active') {
                  <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="undo(m)" [disabled]="busy()"><svg lucideUndo2 class="size-4"></svg> {{ 'Separate again' | t }}</button>
                }
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class DuplicatesPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(DataToolsApi);
  protected readonly pairs = signal<DuplicatePair[] | null>(null);
  protected readonly merges = signal<MergeView[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      if (this.context.active() && this.context.can('member.merge')) untracked(() => void this.load());
    });
  }

  protected describe(p: PersonCard): string {
    return [lifespan(p), p.hometown, generationLabel(p.generation)].filter(Boolean).join(' · ');
  }

  private async load(): Promise<void> {
    const familyId = this.context.active()!.id;
    try {
      const [pairs, merges] = await Promise.all([this.api.duplicates(familyId), this.api.merges(familyId)]);
      this.pairs.set(pairs);
      this.merges.set(merges);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      this.pairs.set([]);
      this.merges.set([]);
    }
  }

  protected async dismiss(p: DuplicatePair): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.dismiss(this.context.active()!.id, p.a.id, p.b.id);
      this.pairs.update((list) => list?.filter((x) => x !== p) ?? null);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async undo(m: MergeView): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.undoMerge(this.context.active()!.id, m.id);
      await this.load();
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
