import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { GenerationInfo } from '@fh/contracts';
import { t } from '../../core/i18n/i18n';
import { generationLabel, generationTone } from '../people';

// Generation tone classes are built dynamically; list them so Tailwind generates them:
// bg-gen-1-tint text-gen-1-ink bg-gen-2-tint text-gen-2-ink bg-gen-3-tint text-gen-3-ink bg-gen-4-tint text-gen-4-ink
// bg-gen-5-tint text-gen-5-ink bg-gen-6-tint text-gen-6-ink bg-gen-7-tint text-gen-7-ink bg-gen-8-tint text-gen-8-ink

@Component({
  selector: 'fh-generation-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'badge whitespace-nowrap', '[class]': 'tone()', '[attr.title]': 'title()' },
  template: `{{ label() }}`,
})
export class GenerationBadgeComponent {
  readonly generation = input.required<GenerationInfo>();
  protected readonly label = computed(() => generationLabel(this.generation()));
  protected readonly tone = computed(() => generationTone(this.generation()));
  protected readonly title = computed(() =>
    this.generation().status === 'pending' && !this.generation().number
      ? t('Generation numbers are calculated automatically once the generation engine runs.')
      : null,
  );
}
