import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A headline number. When the figure does not exist yet, `note` explains why instead of showing 0. */
@Component({
  selector: 'fh-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'card block p-3 sm:p-4' },
  template: `
    <p class="text-[10px] font-medium uppercase leading-tight tracking-wide text-stone-500 sm:text-xs">{{ label() }}</p>
    @if (value() === null) {
      <p class="mt-2 text-sm text-stone-500">{{ note() }}</p>
    } @else {
      <p class="mt-1 font-display text-2xl font-semibold tabular-nums sm:text-3xl">{{ value() }}</p>
      @if (note()) { <p class="mt-0.5 text-xs text-stone-500">{{ note() }}</p> }
    }
  `,
})
export class StatTileComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number | null>();
  readonly note = input<string>('');
}
