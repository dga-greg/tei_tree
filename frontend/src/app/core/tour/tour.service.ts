import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthApi } from '../auth/auth.api';
import { AuthStore } from '../auth/auth.store';
import { mark } from '../i18n/i18n';

export interface TourStep {
  /** The `data-tour` name of the element the step points at; none for a card in the middle of the screen. */
  target?: string;
  title: string;
  body: string;
}

/**
 * The welcome tour, in order. Steps whose element is not on screen (no permission to add people, a phone without the
 * sidebar…) are left out when the tour starts. Elements carry `data-tour="<target>"`; when several do (the sidebar on
 * computers, the ☰ button on phones), the visible one is used.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    title: mark('Welcome to your family archive'),
    body: mark('A quick look around: it takes less than a minute. You can leave at any time, and take the tour again from your account menu.'),
  },
  { target: 'family', title: mark('Your family'), body: mark('This is the family you are looking at. If you belong to more than one, switch between them here.') },
  {
    target: 'add-member',
    title: mark('Add your relatives'),
    body: mark('Start here. Add the founding ancestor’s partner and children, then keep going down to yourself. Every person you add fills in the tree, the generations and the calendar.'),
  },
  { target: 'tree', title: mark('See the family tree'), body: mark('The whole family, from the founding ancestor down. Zoom, drag, and tap a person to see their details.') },
  {
    target: 'nav',
    title: mark('Everything else is in the menu'),
    body: mark('Family history, the calendar, ceremonies, funds, places, the family book and more.'),
  },
  { target: 'account', title: mark('Your account'), body: mark('Your profile, language, appearance and two-step sign-in. You can take this tour again from here.') },
];

/** Set on this device as soon as the tour ends, so it does not come back while the account is being updated. */
const SEEN_KEY = 'fh.tourSeen';

/** The element named `data-tour="<target>"` that is visible now, if any. */
export function tourTarget(target: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly auth = inject(AuthStore);
  private readonly authApi = inject(AuthApi);
  private readonly router = inject(Router);

  readonly steps = signal<readonly TourStep[]>([]);
  readonly index = signal<number | null>(null);
  readonly active = computed(() => this.index() !== null);
  readonly current = computed(() => {
    const i = this.index();
    return i === null ? null : (this.steps()[i] ?? null);
  });

  /** Whether this person has finished or skipped the tour, on any device. */
  seen(): boolean {
    if (this.auth.user()?.preferences.tourSeen) return true;
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  /** Starts the tour on the dashboard the first time someone signs in. */
  offer(): void {
    if (!this.active() && !this.seen() && this.router.url.startsWith('/dashboard')) this.start();
  }

  /** From the account menu: goes to the dashboard (where the tour's elements are) and starts it. */
  async replay(): Promise<void> {
    if (!this.router.url.startsWith('/dashboard')) await this.router.navigateByUrl('/dashboard');
    // The dashboard shows its shortcuts once the families have loaded.
    for (let i = 0; i < 20 && !tourTarget('tree'); i++) await new Promise((r) => setTimeout(r, 100));
    this.start();
  }

  start(): void {
    this.steps.set(TOUR_STEPS.filter((s) => !s.target || tourTarget(s.target)));
    this.index.set(0);
  }

  next(): void {
    const i = this.index();
    if (i === null) return;
    if (i + 1 >= this.steps().length) this.end();
    else this.index.set(i + 1);
  }

  back(): void {
    const i = this.index();
    if (i) this.index.set(i - 1);
  }

  /** Finishing and skipping both count as seen. */
  end(): void {
    this.index.set(null);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* private mode: the account remembers it */
    }
    if (this.auth.user() && !this.auth.user()!.preferences.tourSeen) {
      void this.authApi
        .updateProfile({ preferences: { tourSeen: true } })
        .then((u) => this.auth.setUser(u))
        .catch(() => undefined);
    }
  }
}
