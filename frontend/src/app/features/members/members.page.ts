import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { debounceTime } from 'rxjs';
import { LucidePlus, LucideSearch } from '@lucide/angular';
import { GENERATION_STATUS_LABELS, type GenerationStatus, type MemberSort, type PageMeta, type PersonCard, type VitalStatus, type BranchView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { TreeApi } from '../../core/tree/tree.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { GenerationBadgeComponent } from '../../shared/ui/generation-badge.component';
import { EraBadgeComponent } from '../../shared/ui/era-badge.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-members-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, LucideSearch, LucidePlus, AlertComponent, SpinnerComponent, GenerationBadgeComponent, EraBadgeComponent, PersonAvatarComponent, NoFamilyComponent, TranslatePipe],
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
          @if (context.can('member.merge')) {
            <a routerLink="/members/duplicates" class="btn-secondary">{{ 'Find duplicates' | t }}</a>
          }
          @if (context.can('family.import')) {
            <a routerLink="/family/import" class="btn-secondary">{{ 'Import GEDCOM' | t }}</a>
          }
          @if (context.can('member.create')) {
            <a routerLink="/members/new" class="btn-primary"><svg lucidePlus class="size-4"></svg> {{ 'Add person' | t }}</a>
          }
        </div>
      </header>

      <form [formGroup]="filters" class="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4" role="search" (submit)="$event.preventDefault()">
        <div class="relative sm:col-span-2 lg:col-span-1">
          <svg lucideSearch class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400"></svg>
          <label for="member-q" class="sr-only">{{ 'Search by name' | t }}</label>
          <input id="member-q" type="search" class="input !pl-9" formControlName="q" [placeholder]="'Name, maiden name… (spelling variations are matched)' | t" />
        </div>
        <div>
          <label for="f-status" class="sr-only">{{ 'Status' | t }}</label>
          <select id="f-status" class="input" formControlName="vitalStatus">
            <option value="">{{ 'Living or deceased' | t }}</option>
            <option value="living">{{ 'Living' | t }}</option>
            <option value="deceased">{{ 'Deceased' | t }}</option>
            <option value="unknown">{{ 'Unknown' | t }}</option>
          </select>
        </div>
        <div>
          <label for="f-home" class="sr-only">{{ 'Hometown' | t }}</label>
          <input id="f-home" class="input" formControlName="hometown" [placeholder]="'Hometown' | t" />
        </div>
        <div>
          <label for="f-year" class="sr-only">{{ 'Birth year' | t }}</label>
          <input id="f-year" class="input" type="number" formControlName="birthYear" [placeholder]="'Birth year' | t" />
        </div>
        <div>
          <label for="f-gen" class="sr-only">{{ 'Generation' | t }}</label>
          <input id="f-gen" class="input" type="number" min="1" formControlName="generation" [placeholder]="'Generation' | t" />
        </div>
        <div>
          <label for="f-gstatus" class="sr-only">{{ 'Generation status' | t }}</label>
          <select id="f-gstatus" class="input" formControlName="generationStatus">
            <option value="">{{ 'Any generation status' | t }}</option>
            @for (s of generationStatuses; track s.value) { <option [value]="s.value">{{ s.label | t }}</option> }
          </select>
        </div>
        @if (branches().length) {
          <div>
            <label for="f-branch" class="sr-only">{{ 'Branch' | t }}</label>
            <select id="f-branch" class="input" formControlName="branchId">
              <option value="">{{ 'All branches' | t }}</option>
              @for (b of branches(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
            </select>
          </div>
        }
        <div>
          <label for="f-sort" class="sr-only">{{ 'Sort by' | t }}</label>
          <select id="f-sort" class="input" formControlName="sort">
            <option value="name">{{ 'Sort: name' | t }}</option>
            <option value="birth">{{ 'Sort: birth date' | t }}</option>
            <option value="generation">{{ 'Sort: generation' | t }}</option>
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
                  <p class="truncate text-sm text-stone-500">{{ span(p) || '—' }}@if (p.hometown) { · {{ p.hometown }} }</p>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-1">
                  <fh-generation-badge [generation]="p.generation" />
                  <fh-era-badge [birthDate]="p.birthDate" />
                </div>
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
    q: [''],
    vitalStatus: ['' as VitalStatus | ''],
    hometown: [''],
    birthYear: [null as number | null],
    generation: [this.query.get('generation') ? Number(this.query.get('generation')) : (null as number | null)],
    generationStatus: [(this.query.get('generationStatus') ?? '') as GenerationStatus | ''],
    branchId: [this.query.get('branchId') ?? ''],
    sort: [(this.query.get('sort') ?? 'name') as MemberSort],
  });
  protected readonly generationStatuses = (Object.keys(GENERATION_STATUS_LABELS) as GenerationStatus[])
    .filter((s) => s !== 'pending' && s !== 'computed')
    .map((value) => ({ value, label: GENERATION_STATUS_LABELS[value] }));
  protected readonly people = signal<PersonCard[] | null>(null);
  protected readonly branches = signal<BranchView[]>([]);
  private readonly treeApi = inject(TreeApi);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly span = lifespan;
  private page = 1;
  private request = 0;

  constructor() {
    effect(() => {
      const family = this.context.active();
      if (!family) return;
      untracked(() => {
        void this.go(1);
        this.treeApi.branches(family.id).then((b) => this.branches.set(b)).catch(() => undefined);
      });
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
        hometown: f.hometown.trim() || undefined,
        birthYear: f.birthYear || undefined,
        generation: f.generation || undefined,
        generationStatus: f.generationStatus || undefined,
        branchId: f.branchId || undefined,
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
