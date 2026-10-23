import { A11yModule } from '@angular/cdk/a11y';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { LucideChevronDown, LucideCompass, LucideLogOut, LucideMenu, LucideSettings, LucideX } from '@lucide/angular';
import { FAMILY_ROLE_LABELS } from '@fh/contracts';
import { AuthStore } from '../core/auth/auth.store';
import { FamilyContextStore } from '../core/families/family-context.store';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { TourService } from '../core/tour/tour.service';
import { SidebarNavComponent } from './sidebar-nav.component';
import { TourComponent } from './tour.component';
import { VerifyBannerComponent } from './verify-banner.component';

@Component({
  selector: 'fh-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    RouterOutlet,
    RouterLink,
    A11yModule,
    CdkMenuTrigger,
    CdkMenu,
    CdkMenuItem,
    SidebarNavComponent,
    VerifyBannerComponent,
    TourComponent,
    LucideMenu,
    LucideX,
    LucideChevronDown,
    LucideLogOut,
    LucideSettings,
    LucideCompass,
  ],
  host: { '(document:keydown.escape)': 'drawerOpen.set(false)' },
  template: `
    <a href="#main" class="sr-only z-50 rounded-lg bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
      {{ 'Skip to content' | t }}
    </a>

    <!-- Desktop sidebar -->
    <aside class="fixed inset-y-0 left-0 hidden w-72 lg:block" data-tour="nav">
      <fh-sidebar-nav />
    </aside>

    <!-- Mobile drawer -->
    @if (drawerOpen()) {
      <div class="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" [attr.aria-label]="'Navigation' | t">
        <div class="absolute inset-0 bg-stone-950/50 backdrop-blur-sm" (click)="drawerOpen.set(false)" aria-hidden="true"></div>
        <div class="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
          <fh-sidebar-nav (navigate)="drawerOpen.set(false)" />
          <button type="button" class="btn-ghost absolute right-2 top-3 !p-2 text-white hover:!bg-white/10" (click)="drawerOpen.set(false)" [attr.aria-label]="'Close navigation' | t">
            <svg lucideX class="size-5"></svg>
          </button>
        </div>
      </div>
    }

    <div class="lg:pl-72">
      <header class="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-stone-200 bg-white/85 px-4 backdrop-blur sm:px-6 dark:border-stone-800 dark:bg-stone-950/85">
        <button type="button" class="btn-ghost !p-2 lg:hidden" data-tour="nav" (click)="drawerOpen.set(true)" [attr.aria-label]="'Open navigation' | t" [attr.aria-expanded]="drawerOpen()">
          <svg lucideMenu class="size-5"></svg>
        </button>

        @if (families.families().length > 0) {
          <label class="sr-only" for="family-switcher">{{ 'Active family' | t }}</label>
          <!-- Each option says whether it is chosen: a [value] on the <select> is applied before the options exist, and
               the browser then shows the first family while another one is active. -->
          <select id="family-switcher" data-tour="family" class="input !w-auto max-w-[55vw] !py-2 font-medium sm:max-w-xs"
                  (change)="onFamilyChange($event)">
            @for (f of families.families(); track f.id) {
              <option [value]="f.id" [selected]="f.id === families.active()?.id">{{ f.name }}</option>
            }
          </select>
          @if (activeRoleLabel(); as role) {
            <span class="badge hidden bg-brand-50 text-brand-800 sm:inline-flex dark:bg-brand-950 dark:text-brand-200">{{ role | t }}</span>
          }
        }

        <div class="ml-auto">
          <button type="button" class="btn-ghost !px-2" data-tour="account" [cdkMenuTriggerFor]="userMenu" [attr.aria-label]="'Account menu' | t">
            <span class="flex size-8 items-center justify-center rounded-full bg-brand-700 text-xs font-bold text-white" aria-hidden="true">
              {{ initials() }}
            </span>
            <span class="hidden max-w-40 truncate text-sm font-medium sm:inline">{{ auth.user()?.displayName }}</span>
            <svg lucideChevronDown class="size-4 opacity-60"></svg>
          </button>
          <ng-template #userMenu>
            <div cdkMenu class="card mt-2 min-w-56 overflow-hidden p-1.5 shadow-(--shadow-raised)">
              <div class="px-3 py-2 text-xs text-stone-500">
                {{ 'Signed in as' | t }}<br />
                <span class="font-medium text-stone-800 dark:text-stone-200">{{ auth.user()?.email }}</span>
              </div>
              <a cdkMenuItem routerLink="/settings" class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-stone-100 dark:hover:bg-stone-800">
                <svg lucideSettings class="size-4"></svg> {{ 'Settings' | t }}
              </a>
              <button cdkMenuItem type="button" (cdkMenuItemTriggered)="tour.replay()" class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800">
                <svg lucideCompass class="size-4"></svg> {{ 'Take the tour' | t }}
              </button>
              <button cdkMenuItem type="button" (cdkMenuItemTriggered)="logout()" class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-800">
                <svg lucideLogOut class="size-4"></svg> {{ 'Sign out' | t }}
              </button>
            </div>
          </ng-template>
        </div>
      </header>
      <fh-verify-banner />

      <main id="main" tabindex="-1" class="outline-none" [class]="fullBleed() ? 'w-full' : 'mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8'">
        <router-outlet />
      </main>
    </div>

    <fh-tour />
  `,
})
export class ShellComponent {
  protected readonly auth = inject(AuthStore);
  protected readonly families = inject(FamilyContextStore);
  protected readonly tour = inject(TourService);
  protected readonly drawerOpen = signal(false);
  private readonly router = inject(Router);
  /** The family tree uses the whole width below the top bar. */
  protected readonly fullBleed = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.startsWith('/tree')),
      startWith(this.router.url.startsWith('/tree')),
    ),
    { initialValue: false },
  );

  protected readonly initials = computed(() =>
    (this.auth.user()?.displayName ?? '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join(''),
  );
  protected readonly activeRoleLabel = computed(() => {
    const role = this.families.active()?.role;
    return role ? FAMILY_ROLE_LABELS[role] : null;
  });

  constructor() {
    // Usually already on its way: start-up asks for the families as soon as the session is confirmed.
    void this.families.ensureLoaded();
  }

  protected onFamilyChange(event: Event): void {
    void this.families.select((event.target as HTMLSelectElement).value);
  }

  protected async logout(): Promise<void> {
    this.families.clear();
    await this.auth.logout();
  }
}
