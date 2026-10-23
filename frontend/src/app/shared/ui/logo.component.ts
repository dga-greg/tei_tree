import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Brand mark: a stylised tree whose roots and branches mirror each other — ancestors and descendants. */
@Component({
  selector: 'fh-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'inline-flex items-center gap-2.5' },
  template: `
    <svg viewBox="0 0 40 40" class="size-9 shrink-0" aria-hidden="true">
      <rect width="40" height="40" rx="11" class="fill-brand-900" />
      <path d="M20 31V12" class="stroke-gold-300" stroke-width="2.4" stroke-linecap="round" />
      <path d="M20 18l-7-5M20 18l7-5M20 24l-8-3M20 24l8-3" class="stroke-brand-100" stroke-width="2" stroke-linecap="round" />
      <circle cx="20" cy="10" r="2.6" class="fill-gold-300" />
      <circle cx="12" cy="12.5" r="2" class="fill-brand-200" />
      <circle cx="28" cy="12.5" r="2" class="fill-brand-200" />
      <circle cx="11" cy="20.5" r="1.8" class="fill-brand-300" />
      <circle cx="29" cy="20.5" r="1.8" class="fill-brand-300" />
    </svg>
    @if (withText()) {
      <span class="font-display text-lg font-semibold leading-tight" [class.text-white]="inverse()">
        {{ 'Family Heritage' | t }}
      </span>
    }
  `,
})
export class LogoComponent {
  readonly withText = input(true);
  readonly inverse = input(false);
}
