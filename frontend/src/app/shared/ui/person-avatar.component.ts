import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { initials } from '../people';

@Component({
  selector: 'fh-person-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    class: 'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-100',
    '[class]': "size() === 'lg' ? 'size-20 text-2xl' : size() === 'sm' ? 'size-8 text-xs' : 'size-11 text-sm'",
  },
  template: `
    @if (photoUrl() && !failed()) {
      <img [src]="photoUrl()" alt="" class="size-full object-cover" loading="lazy" (error)="failed.set(true)" />
    } @else {
      {{ letters() }}
    }
  `,
})
export class PersonAvatarComponent {
  readonly name = input.required<string>();
  readonly photoUrl = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  protected readonly letters = computed(() => initials(this.name()));
  /** Falls back to initials when the photo cannot be shown (removed, or not visible to this viewer). */
  protected readonly failed = linkedSignal({ source: this.photoUrl, computation: () => false });
}
