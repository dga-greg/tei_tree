import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { LogoComponent } from '../shared/ui/logo.component';

@Component({
  selector: 'fh-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterOutlet, LogoComponent],
  template: `
    <div class="grid min-h-dvh lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section class="relative hidden overflow-hidden bg-brand-950 p-12 text-brand-50 lg:flex lg:flex-col xl:p-16" aria-hidden="true">
        <fh-logo [inverse]="true" />
        <div class="mt-12 max-w-xl">
          <p class="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-gold-300">{{ 'Generation 1 → ∞' | t }}</p>
          <h2 class="text-4xl leading-tight font-semibold text-white">{{ 'Every family is a story worth keeping.' | t }}</h2>
          <p class="mt-5 text-base leading-relaxed text-brand-200">
            {{ 'Record your ancestors, trace every branch of descendants and preserve the photographs, stories and traditions that make your family who it is — privately, together.' | t }}
          </p>
        </div>
        <!-- The family tree picture: replace public/images/auth-tree.svg to use another one. -->
        <div class="relative mt-8 min-h-48 flex-1">
          <img src="/images/auth-tree.svg" alt="" class="absolute inset-0 size-full object-contain object-bottom" />
        </div>
      </section>
      <main class="flex items-center justify-center px-4 py-10 sm:px-8">
        <div class="w-full max-w-md">
          <div class="mb-8 flex items-center justify-between gap-4"><fh-logo class="lg:invisible" /></div>
          <router-outlet />
        </div>
      </main>
    </div>
  `,
})
export class AuthLayoutComponent {}
