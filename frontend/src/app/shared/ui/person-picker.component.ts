import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subject, switchMap, from, of, catchError } from 'rxjs';
import type { PersonCard } from '@fh/contracts';
import { MembersApi } from '../../core/members/members.api';
import { lifespan } from '../people';
import { PersonAvatarComponent } from './person-avatar.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

let nextId = 0;

/** Accessible combobox for choosing an existing person of the family by name (partial or phonetic). */
@Component({
  selector: 'fh-person-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, PersonAvatarComponent, TranslatePipe],
  template: `
    <label class="label" [for]="id">{{ label() }}</label>
    @if (selected(); as p) {
      <div class="flex items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 px-3 py-2 dark:border-brand-800 dark:bg-brand-950">
        <fh-person-avatar [name]="p.displayName" size="sm" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold">{{ p.displayName }}</p>
          <p class="text-xs text-stone-500">{{ span(p) }}</p>
        </div>
        <button type="button" class="btn-ghost !px-2 !py-1 text-xs" (click)="clear()">{{ 'Change' | t }}</button>
      </div>
    } @else {
      <div class="relative">
        <input class="input" [id]="id" role="combobox" autocomplete="off" aria-autocomplete="list" [attr.aria-expanded]="results().length > 0" [attr.aria-controls]="id + '-list'" [attr.aria-activedescendant]="active() >= 0 ? id + '-opt-' + active() : null" [formControl]="query" [placeholder]="'Start typing a name…' | t" (keydown)="onKey($event)" />
        @if (results().length > 0) {
          <ul [id]="id + '-list'" role="listbox" class="card absolute z-20 mt-1 max-h-72 w-full overflow-auto p-1 shadow-(--shadow-raised)">
            @for (p of results(); track p.id; let i = $index) {
              <li [id]="id + '-opt-' + i" role="option" [attr.aria-selected]="i === active()" class="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5" [class]="i === active() ? 'bg-stone-100 dark:bg-stone-800' : ''" (mousedown)="$event.preventDefault(); choose(p)" (mouseenter)="active.set(i)">
                <fh-person-avatar [name]="p.displayName" size="sm" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{{ p.displayName }}</span>
                  <span class="block text-xs text-stone-500">{{ span(p) }}</span>
                </span>
              </li>
            }
          </ul>
        } @else if (searched() && query.value.trim().length >= 2) {
          <p class="mt-1 text-xs text-stone-500" role="status">{{ 'No one in this family matches “{query}”.' | t: { query: query.value } }}</p>
        }
      </div>
    }
  `,
})
export class PersonPickerComponent {
  private readonly membersApi = inject(MembersApi);
  readonly familyId = input.required<string>();
  readonly label = input(t('Person'));
  /** People who must not be offered (e.g. the profile being edited). */
  readonly exclude = input<string[]>([]);
  readonly picked = output<PersonCard | null>();
  /** Pre-selected person (e.g. from a link); changing it replaces the selection without emitting. */
  readonly value = input<PersonCard | null>(null);

  protected readonly id = `fh-person-${nextId++}`;
  protected readonly query = new FormControl('', { nonNullable: true });
  protected readonly results = signal<PersonCard[]>([]);
  protected readonly selected = signal<PersonCard | null>(null);
  protected readonly active = signal(-1);
  protected readonly searched = signal(false);
  protected readonly span = lifespan;

  constructor() {
    effect(() => {
      const v = this.value();
      untracked(() => this.selected.set(v));
    });
    this.query.valueChanges
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((q) =>
          q.trim().length < 2 ? of([] as PersonCard[]) : from(this.membersApi.search(this.familyId(), q.trim())).pipe(catchError(() => of([] as PersonCard[]))),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((people) => {
        this.results.set(people.filter((p) => !this.exclude().includes(p.id)));
        this.active.set(people.length ? 0 : -1);
        this.searched.set(true);
      });
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.results().length;
    if (!n) return;
    if (event.key === 'ArrowDown') this.active.update((i) => (i + 1) % n);
    else if (event.key === 'ArrowUp') this.active.update((i) => (i - 1 + n) % n);
    else if (event.key === 'Enter' && this.active() >= 0) this.choose(this.results()[this.active()]!);
    else if (event.key === 'Escape') this.results.set([]);
    else return;
    event.preventDefault();
  }

  protected choose(p: PersonCard): void {
    this.selected.set(p);
    this.results.set([]);
    this.picked.emit(p);
  }

  clear(): void {
    this.selected.set(null);
    this.query.setValue('');
    this.searched.set(false);
    this.picked.emit(null);
  }
}
