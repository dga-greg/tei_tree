import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BIRTH_ERA_LABELS, birthEraOf, type FuzzyDate } from '@fh/contracts';
import { t } from '../../core/i18n/i18n';

/** The era a person was born in ("Gen X", "Millennial"), from the birth date the viewer may see. Empty otherwise. */
@Component({
  selector: 'fh-era-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "era() ? 'badge whitespace-nowrap bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300' : 'hidden'", '[attr.title]': 'title()' },
  template: `@if (era(); as e) { {{ label() }} }`,
})
export class EraBadgeComponent {
  readonly birthDate = input<FuzzyDate | null>(null);
  protected readonly era = computed(() => birthEraOf(this.birthDate()));
  protected readonly label = computed(() => {
    const e = this.era();
    return e ? t(BIRTH_ERA_LABELS[e.key].short) : '';
  });
  protected readonly title = computed(() => {
    const e = this.era();
    return e ? t('{era}: born {from}–{to}', { era: t(BIRTH_ERA_LABELS[e.key].name), from: e.from, to: e.to }) : null;
  });
}
