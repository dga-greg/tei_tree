import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, RouterLink],
  template: `
    <div class="flex min-h-[60dvh] flex-col items-center justify-center p-8 text-center">
      <p class="text-sm font-semibold text-brand-700">404</p>
      <h1 class="mt-2 text-3xl font-semibold">{{ 'This page could not be found' | t }}</h1>
      <p class="mt-3 text-stone-600 dark:text-stone-400">{{ 'The link may be broken, or the page may have moved.' | t }}</p>
      <a routerLink="/" class="btn-primary mt-8">{{ 'Go home' | t }}</a>
    </div>
  `,
})
export class NotFoundPage {}
