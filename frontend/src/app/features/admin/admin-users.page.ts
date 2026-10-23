import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideSearch } from '@lucide/angular';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PLATFORM_ROLE_LABELS, type AdminFamilyView, type AdminUserView, type PageMeta, type PlatformStats } from '@fh/contracts';
import { FamiliesApi } from '../../core/families/families.api';
import { AdminApi } from '../../core/admin.api';
import { ApiError } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { AlertComponent } from '../../shared/ui/alert.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Platform account administration. Shows no genealogy data by design. */
@Component({
  selector: 'fh-admin-users-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DatePipe, RouterLink, AlertComponent, SpinnerComponent, LucideSearch, TranslatePipe],
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-semibold">{{ 'Platform administration' | t }}</h1>
        <p class="mt-1 text-sm text-stone-500">{{ 'Accounts and registrations. Family records are private to each family and are not shown here.' | t }}</p>
      </div>
      <a routerLink="/admin/reports" class="btn-secondary">{{ 'Reports' | t }}</a>
    </header>

    @if (stats(); as s) {
      <dl class="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        @for (card of statCards(s); track card.label) {
          <div class="card p-4">
            <dt class="text-xs font-medium uppercase tracking-wide text-stone-500">{{ card.label }}</dt>
            <dd class="mt-1 font-display text-3xl font-semibold">{{ card.value }}</dd>
          </div>
        }
      </dl>
    }

    @if (error(); as e) {
      <fh-alert class="mb-4">{{ e }}</fh-alert>
    }

    <section class="card overflow-hidden" aria-labelledby="accounts-heading">
      <div class="flex flex-wrap items-center gap-3 border-b border-stone-200 p-4 dark:border-stone-800">
        <h2 id="accounts-heading" class="mr-auto text-lg font-semibold">{{ 'Accounts' | t }}</h2>
        <div class="relative">
          <svg lucideSearch class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400"></svg>
          <label for="user-search" class="sr-only">{{ 'Search accounts' | t }}</label>
          <input id="user-search" type="search" class="input !w-64 !pl-9" [placeholder]="'Search name or e-mail' | t" [formControl]="search" />
        </div>
        <label for="status-filter" class="sr-only">{{ 'Status' | t }}</label>
        <select id="status-filter" class="input !w-auto" [formControl]="status">
          <option value="">{{ 'All statuses' | t }}</option>
          <option value="active">{{ 'Active' | t }}</option>
          <option value="suspended">{{ 'Suspended' | t }}</option>
        </select>
      </div>

      @if (users() === null) {
        <div class="p-6"><fh-spinner [showLabel]="true" /></div>
      } @else {
        <div class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-left text-sm">
            <thead class="bg-stone-50 text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900">
              <tr>
                <th scope="col" class="px-4 py-3 font-semibold">{{ 'Account' | t }}</th>
                <th scope="col" class="px-4 py-3 font-semibold">{{ 'Role' | t }}</th>
                <th scope="col" class="px-4 py-3 font-semibold">{{ 'Families' | t }}</th>
                <th scope="col" class="px-4 py-3 font-semibold">{{ 'Last sign-in' | t }}</th>
                <th scope="col" class="px-4 py-3 font-semibold">{{ 'Status' | t }}</th>
                <th scope="col" class="px-4 py-3"><span class="sr-only">{{ 'Actions' | t }}</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-stone-200 dark:divide-stone-800">
              @for (u of users(); track u.id) {
                <tr>
                  <td class="px-4 py-3">
                    <p class="font-medium">{{ u.displayName }}</p>
                    <p class="text-xs text-stone-500">{{ u.email }}</p>
                  </td>
                  <td class="px-4 py-3">{{ roleLabels[u.platformRole] | t }}</td>
                  <td class="px-4 py-3">{{ u.familyCount }}</td>
                  <td class="px-4 py-3 text-stone-500">{{ u.lastLoginAt ? (u.lastLoginAt | date: 'medium') : ('Never' | t) }}</td>
                  <td class="px-4 py-3">
                    <span class="badge" [class]="u.status === 'active' ? 'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200' : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'">
                      {{ u.status === 'active' ? ('Active' | t) : ('Suspended' | t) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right">
                    @if (u.id !== auth.user()?.id) {
                      <button type="button" class="btn-secondary !py-1.5 text-xs" [disabled]="pending() === u.id" (click)="toggleStatus(u)">
                        {{ u.status === 'active' ? ('Suspend' | t) : ('Reactivate' | t) }}
                      </button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="px-4 py-10 text-center text-stone-500">{{ 'No accounts match.' | t }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (meta(); as m) {
          <nav class="flex items-center justify-between border-t border-stone-200 p-4 text-sm dark:border-stone-800" [attr.aria-label]="'Pagination' | t">
            <span class="text-stone-500">{{ pageSummary(m) }}</span>
            <div class="flex gap-2">
              <button type="button" class="btn-secondary !py-1.5" [disabled]="m.page <= 1" (click)="goTo(m.page - 1)">{{ 'Previous' | t }}</button>
              <button type="button" class="btn-secondary !py-1.5" [disabled]="m.page >= m.totalPages" (click)="goTo(m.page + 1)">{{ 'Next' | t }}</button>
            </div>
          </nav>
        }
      }
    </section>

    <section class="card mt-8 overflow-hidden" aria-labelledby="families-heading">
      <div class="border-b border-stone-200 p-4 dark:border-stone-800">
        <h2 id="families-heading" class="text-lg font-semibold">{{ 'Family registrations' | t }}</h2>
        <p class="text-xs text-stone-500">{{ 'Names, owners and counts only. Suspending a family hides it from everyone but its members.' | t }}</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] text-left text-sm">
          <thead class="bg-stone-50 text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900">
            <tr>
              <th scope="col" class="px-4 py-3 font-semibold">{{ 'Family' | t }}</th>
              <th scope="col" class="px-4 py-3 font-semibold">{{ 'Registered by' | t }}</th>
              <th scope="col" class="px-4 py-3 font-semibold">{{ 'People' | t }}</th>
              <th scope="col" class="px-4 py-3 font-semibold">{{ 'Accounts' | t }}</th>
              <th scope="col" class="px-4 py-3 font-semibold">{{ 'Status' | t }}</th>
              <th scope="col" class="px-4 py-3"><span class="sr-only">{{ 'Actions' | t }}</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-200 dark:divide-stone-800">
            @for (f of familyRows(); track f.id) {
              <tr>
                <td class="px-4 py-3"><p class="font-medium">{{ f.name }}</p><p class="text-xs text-stone-500">{{ f.visibility }} · {{ f.createdAt | date: 'mediumDate' }}</p></td>
                <td class="px-4 py-3 text-stone-600 dark:text-stone-300">{{ f.createdBy?.email ?? '—' }}</td>
                <td class="px-4 py-3">{{ f.memberCount }}</td>
                <td class="px-4 py-3">{{ f.accountCount }}</td>
                <td class="px-4 py-3 capitalize">{{ f.status }}</td>
                <td class="px-4 py-3 text-right">
                  <button type="button" class="btn-secondary !py-1.5 text-xs" [disabled]="pending() === f.id" (click)="toggleFamily(f)">
                    {{ f.status === 'active' ? ('Suspend' | t) : ('Reactivate' | t) }}
                  </button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="px-4 py-10 text-center text-stone-500">{{ 'No families registered yet.' | t }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class AdminUsersPage {
  private readonly adminApi = inject(AdminApi);
  private readonly familiesApi = inject(FamiliesApi);
  protected readonly familyRows = signal<AdminFamilyView[]>([]);
  protected readonly auth = inject(AuthStore);
  protected readonly roleLabels = PLATFORM_ROLE_LABELS;

  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly status = new FormControl('', { nonNullable: true });
  protected readonly stats = signal<PlatformStats | null>(null);
  protected readonly users = signal<AdminUserView[] | null>(null);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly pending = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  private page = 1;

  constructor() {
    void this.loadStats();
    void this.load();
    void this.loadFamilies();
    this.search.valueChanges.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed()).subscribe(() => this.goTo(1));
    this.status.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.goTo(1));
  }

  private async loadStats(): Promise<void> {
    try {
      this.stats.set(await this.adminApi.stats());
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  private async load(): Promise<void> {
    try {
      const res = await this.adminApi.users({
        page: this.page,
        pageSize: 20,
        q: this.search.value.trim() || undefined,
        status: this.status.value || undefined,
      });
      this.users.set(res.data);
      this.meta.set(res.meta);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      this.users.set([]);
    }
  }

  private async loadFamilies(): Promise<void> {
    try {
      this.familyRows.set((await this.familiesApi.adminList({ page: 1, pageSize: 50 })).data);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected async toggleFamily(f: AdminFamilyView): Promise<void> {
    this.pending.set(f.id);
    try {
      await this.familiesApi.adminSetStatus(f.id, f.status === 'active' ? 'suspended' : 'active');
      await this.loadFamilies();
      void this.loadStats();
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.pending.set(null);
    }
  }

  protected statCards(s: PlatformStats): { label: string; value: number }[] {
    return [
      { label: t('Accounts'), value: s.users.total },
      { label: t('Active accounts'), value: s.users.active },
      { label: t('Suspended'), value: s.users.suspended },
      { label: t('Families'), value: s.families.total },
    ];
  }

  protected pageSummary(m: PageMeta): string {
    return t('{count, plural, other {{count} accounts}} · page {page} of {total}', { count: m.total, page: m.page, total: m.totalPages });
  }

  protected goTo(page: number): void {
    this.page = page;
    void this.load();
  }

  protected async toggleStatus(user: AdminUserView): Promise<void> {
    this.pending.set(user.id);
    this.error.set(null);
    try {
      const updated = await this.adminApi.updateUser(user.id, { status: user.status === 'active' ? 'suspended' : 'active' });
      this.users.update((list) => list?.map((u) => (u.id === updated.id ? updated : u)) ?? null);
      void this.loadStats();
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.pending.set(null);
    }
  }
}
