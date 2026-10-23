import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** A person's family ID (G1, G1.2, G1.2-W1), or a quiet note when they are not linked to the family yet. */
@Component({
  selector: 'fh-family-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  template: `
    @if (code(); as c) {
      <span class="badge bg-brand-700 font-mono tracking-tight text-white" [attr.aria-label]="'Family ID {code}' | t: { code: c }" data-testid="family-code">{{ c }}</span>
    } @else if (showMissing()) {
      <span class="badge bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400" [title]="'Given once they are linked to a parent or partner in the family' | t">{{ 'No ID yet' | t }}</span>
    }
  `,
})
export class FamilyCodeComponent {
  readonly code = input<string | null>(null);
  readonly showMissing = input(true);
}
