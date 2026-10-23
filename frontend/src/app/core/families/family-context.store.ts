import { Injectable, computed, inject, signal } from '@angular/core';
import { canFamily, type FamilyPermission, type FamilySummary, type FamilyView } from '@fh/contracts';
import { ApiError } from '../api/api-error';
import { AuthApi } from '../auth/auth.api';
import { AuthStore } from '../auth/auth.store';
import { FamiliesApi } from './families.api';

/** The families the user belongs to and the one currently being worked on. */
@Injectable({ providedIn: 'root' })
export class FamilyContextStore {
  private readonly familiesApi = inject(FamiliesApi);
  private readonly authApi = inject(AuthApi);
  private readonly auth = inject(AuthStore);

  private readonly _families = signal<FamilySummary[]>([]);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _selectedId = signal<string | null>(null);
  private readonly _details = signal<FamilyView | null>(null);

  readonly families = this._families.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly error = this._error.asReadonly();

  readonly active = computed<FamilySummary | null>(() => {
    const families = this._families();
    const preferred = this._selectedId() ?? this.auth.user()?.preferences.defaultFamilyId ?? null;
    return families.find((f) => f.id === preferred) ?? families[0] ?? null;
  });

  /** Full details (settings, founder, version) of the active family, once loaded. */
  readonly details = computed(() => {
    const d = this._details();
    return d && d.id === this.active()?.id ? d : null;
  });

  /** UI hint only; the server re-checks every permission. */
  can(permission: FamilyPermission): boolean {
    const family = this.active();
    return family ? canFamily({ role: family.role, treasurer: family.treasurer }, permission) : false;
  }

  /** The latest load still running, and whose families the list holds. */
  private inflight: Promise<void> | null = null;
  private loadedFor: string | null = null;

  /**
   * Loads this person's families unless they are already here or on their way (start-up, the shell). `listed` runs
   * once the list has arrived, before the active family's details.
   */
  ensureLoaded(listed?: () => void): Promise<void> {
    if (this.inflight) return this.inflight;
    if (this._loaded() && this.loadedFor === (this.auth.user()?.id ?? null)) return Promise.resolve();
    return this.load(listed);
  }

  /** Always fetches afresh: after joining, creating or leaving a family. */
  load(listed?: () => void): Promise<void> {
    const run = this.fetch(listed).finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async fetch(listed?: () => void): Promise<void> {
    this.loadedFor = this.auth.user()?.id ?? null;
    this._loading.set(true);
    this._error.set(null);
    try {
      this._families.set(await this.familiesApi.listMine());
      this._loaded.set(true);
      listed?.();
      await this.loadDetails();
    } catch (err) {
      this._error.set(ApiError.from(err).message);
    } finally {
      this._loading.set(false);
    }
  }

  async loadDetails(): Promise<FamilyView | null> {
    const active = this.active();
    if (!active) {
      this._details.set(null);
      return null;
    }
    const details = await this.familiesApi.get(active.id);
    this._details.set(details);
    return details;
  }

  /** Keeps the cached copy and the summary list in step after an edit. */
  setDetails(details: FamilyView): void {
    this._details.set(details);
    this._families.update((list) =>
      list.map((f) =>
        f.id === details.id
          ? { ...f, name: details.name, origin: details.origin, memberCount: details.stats.memberCount, generationCount: details.stats.generationCount }
          : f,
      ),
    );
  }

  async select(familyId: string): Promise<void> {
    this._selectedId.set(familyId);
    void this.loadDetails().catch(() => undefined);
    try {
      this.auth.setUser(await this.authApi.updateProfile({ preferences: { defaultFamilyId: familyId } }));
    } catch {
      // The selection still applies for this session; persisting it is best-effort.
    }
  }

  /** Refreshes counts after people are added or removed. */
  async refresh(): Promise<void> {
    try {
      this._families.set(await this.familiesApi.listMine());
      await this.loadDetails();
    } catch {
      // Non-critical; the next navigation retries.
    }
  }

  clear(): void {
    this._families.set([]);
    this._selectedId.set(null);
    this._details.set(null);
    this._loaded.set(false);
    this.loadedFor = null;
  }
}
