import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideSprout } from '@lucide/angular';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-no-family',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink, LucideSprout],
  template: `
    <div class="card relative overflow-hidden p-8 sm:p-10">
      <div class="absolute -right-10 -top-10 size-48 rounded-full bg-brand-50 dark:bg-brand-950" aria-hidden="true"></div>
      <div class="relative max-w-xl">
        <span class="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100">
          <svg lucideSprout class="size-6"></svg>
        </span>
        <h2 class="text-2xl font-semibold">{{ 'You are not part of a family tree yet' | t }}</h2>
        <p class="mt-3 text-stone-600 dark:text-stone-400">
          {{ 'Register your family to start recording its founding ancestor, its people and their stories. If a relative has already started one, ask them to invite you.' | t }}
        </p>
        <a routerLink="/families/new" class="btn-primary mt-6">{{ 'Register a family' | t }}</a>
      </div>
    </div>
  `,
})
export class NoFamilyComponent {}
