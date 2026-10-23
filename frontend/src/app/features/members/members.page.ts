import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import { LucidePlus, LucideSearch } from '@lucide/angular';
import type { MemberSort, PageMeta, PersonCard, VitalStatus } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FamilyCodeComponent } from '../../shared/ui/family-code.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-members-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, LucideSearch, LucidePlus, AlertComponent, SpinnerComponent, FamilyCodeComponent, PersonAvatarComponent, NoFamilyComponent, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Family members' | t }}</h1>
          <p class="mt-1 text-sm text-stone-500">
            @if (meta(); as m) {
              {{ '{count, plural, one {# person} other {# people}} in the {family}' | t: { count: m.total, family: context.active()!.name } }} <!-- i18n-ignore -->
            } @else {
              {{ '… people in the {family}' | t: { family: context.active()!.name } }}
            }
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          @if (context.can('member.create')) {
            <a routerLink="/members/new" class="btn-primary"><svg lucidePlus class="size-4"></svg> {{ 'Add person' | t }}</a>
          }
        </div>
      </header>

      <form [formGroup]="filters" class="card mb-6 grid gap-3 p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]" role="search" (submit)="$event.preventDefault()">
        <div class="relative">
          <svg lucideSearch class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400"></svg>
          <label for="member-q" class="sr-only">{{ 'Search by name or family ID' | t }}</label>
          <input id="member-q" type="search" class="input !pl-9" formControlName="q" [placeholder]="'Name or family ID, e.g. G1.2' | t" />
        </div>
        <div>
          <label for="f-status" class="sr-only">{{ 'Status' | t }}</label>
          <select id="f-status" class="input" formControlName="vitalStatus">
            <option value="">{{ 'Any status' | t }}</option>
            <option value="living">{{ 'Living' | t }}</option>
            <option value="deceased">{{ 'Deceased' | t }}</option>
            <option value="unknown">{{ 'Unknown' | t }}</option>
          </select>
        </div>
        <div>
          <label for="f-sort" class="sr-only">{{ 'Sort by' | t }}</label>
          <select id="f-sort" class="input" formControlName="sort">
            <option value="code">{{ 'Sort: family ID' | t }}</option>
            <option value="name">{{ 'Sort: name' | t }}</option>
            <option value="birth">{{ 'Sort: date of birth' | t }}</option>
            <option value="recent">{{ 'Sort: recently added' | t }}</option>
          </select>
        </div>
      </form>

      @if (error(); as e) { <fh-alert class="mb-4">{{ e }}</fh-alert> }

      @if (people() === null) {
        <fh-spinner [showLabel]="true" />
      } @else if (people()!.length === 0) {
        <div class="card p-10 text-center">
          <p class="font-medium">{{ 'No one matches these filters.' | t }}</p>
          @if (context.can('member.create')) {
            <a routerLink="/members/new" class="btn-secondary mt-4">{{ 'Add a person' | t }}</a>
          }
        </div>
      } @else {
        <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
          @for (p of people(); track p.id) {
            <li>
              <a [routerLink]="['/members', p.id]" class="card flex items-center gap-3 p-4 transition hover:shadow-(--shadow-raised)">
                <fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-semibold">{{ p.displayName }}</p>
                  @if (p.preferredName) { <p class="truncate text-xs text-stone-500">{{ 'Known as {name}' | t: { name: p.preferredName } }}</p> }
                  <p class="truncate text-sm text-stone-500">{{ span(p) || '—' }}@if (p.residence) { · {{ p.residence }} }</p>
                </div>
                <fh-family-code class="shrink-0" [code]="p.familyCode" />
              </a>
            </li>
          }
        </ul>
        @if (meta(); as m) {
          @if (m.totalPages > 1) {
            <nav class="mt-6 flex items-center justify-between text-sm" [attr.aria-label]="'Pagination' | t">
              <span class="text-stone-500">{{ 'Page {page} of {pages}' | t: { page: m.page, pages: m.totalPages } }}</span>
              <div class="flex gap-2">
                <button type="button" class="btn-secondary !py-1.5" [disabled]="m.page <= 1" (click)="go(m.page - 1)">{{ 'Previous' | t }}</button>
                <button type="button" class="btn-secondary !py-1.5" [disabled]="m.page >= m.totalPages" (click)="go(m.page + 1)">{{ 'Next' | t }}</button>
              </div>
            </nav>
          }
        }
      }
    }
  `,
})
export class MembersPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly membersApi = inject(MembersApi);

  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly filters = inject(NonNullableFormBuilder).group({
    q: [this.query.get('q') ?? ''],
    vitalStatus: ['' as VitalStatus | ''],
    sort: [(this.query.get('sort') ?? 'code') as MemberSort],
  });
  protected readonly people = signal<PersonCard[] | null>(null);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly span = lifespan;
  private page = 1;
  private request = 0;

  constructor() {
    effect(() => {
      const family = this.context.active();
      if (!family) return;
      untracked(() => void this.go(1));
    });
    this.filters.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe(() => this.go(1));
  }

  protected async go(page: number): Promise<void> {
    const family = this.context.active();
    if (!family) return;
    this.page = page;
    const ticket = ++this.request;
    const f = this.filters.getRawValue();
    try {
      const res = await this.membersApi.list(family.id, {
        q: f.q.trim() || undefined,
        vitalStatus: f.vitalStatus || undefined,
        sort: f.sort,
        page: this.page,
        pageSize: 30,
      });
      if (ticket !== this.request) return; // a newer search superseded this one
      this.people.set(res.data);
      this.meta.set(res.meta);
      this.error.set(null);
    } catch (err) {
      if (ticket === this.request) this.error.set(ApiError.from(err).message);
    }
  }
}
