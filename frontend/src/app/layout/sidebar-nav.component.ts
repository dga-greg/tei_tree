import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';
import { AuthStore } from '../core/auth/auth.store';
import { FamilyContextStore } from '../core/families/family-context.store';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { NAV_ITEMS } from '../core/navigation';
import { LogoComponent } from '../shared/ui/logo.component';

@Component({
  selector: 'fh-sidebar-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink, RouterLinkActive, LucideDynamicIcon, LogoComponent],
  host: { class: 'flex h-full flex-col bg-brand-950 text-brand-100' },
  template: `
    <div class="flex h-16 items-center px-5">
      <a routerLink="/dashboard" class="rounded-lg" (click)="navigate.emit()">
        <fh-logo [inverse]="true" />
      </a>
    </div>
    <nav [attr.aria-label]="'Main' | t" class="flex-1 overflow-y-auto px-3 pb-6">
      <ul class="space-y-0.5">
        @for (item of items(); track item.path) {
          <li>
            @if (item.phase) {
              <a [routerLink]="item.path" (click)="navigate.emit()" class="group flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-brand-300/70 hover:bg-white/5"
                 routerLinkActive="bg-white/10 text-white" [attr.aria-label]="'{label} (coming in phase {phase})' | t: { label: (item.label | t), phase: item.phase }">
                <svg [lucideIcon]="item.icon" class="size-[18px] shrink-0 opacity-70"></svg>
                <span class="flex-1">{{ item.label | t }}</span>
                <span class="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brand-300/80">
                  {{ 'Phase {phase}' | t: { phase: item.phase } }}
                </span>
              </a>
            } @else {
              <a [routerLink]="item.path" (click)="navigate.emit()" class="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-brand-100 hover:bg-white/5 hover:text-white"
                 routerLinkActive="bg-white/10 !text-white shadow-inner" ariaCurrentWhenActive="page">
                <svg [lucideIcon]="item.icon" class="size-[18px] shrink-0"></svg>
                <span>{{ item.label | t }}</span>
              </a>
            }
          </li>
        }
      </ul>
    </nav>
    <div class="m-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-brand-200/80">
      {{ 'Preserving family history for the generations still to come.' | t }}
    </div>
  `,
})
export class SidebarNavComponent {
  private readonly auth = inject(AuthStore);
  private readonly families = inject(FamilyContextStore);
  readonly navigate = output<void>();
  readonly items = computed(() =>
    NAV_ITEMS.filter(
      (i) => (!i.superAdminOnly || this.auth.isSuperAdmin()) && (!i.familyAdminOnly || this.families.active()?.role === 'family_admin') &&
        (!i.requires || this.families.can(i.requires)),
    ),
  );
}
