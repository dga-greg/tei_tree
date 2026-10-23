import { ChangeDetectionStrategy, Component, computed, input, model, viewChild } from '@angular/core';
import { LucideX } from '@lucide/angular';
import type { PersonCard } from '@fh/contracts';
import { PersonAvatarComponent } from './person-avatar.component';
import { PersonPickerComponent } from './person-picker.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Several people (e.g. who is in a photo): chips plus a search box to add more. */
@Component({
  selector: 'fh-people-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PersonPickerComponent, PersonAvatarComponent, LucideX, TranslatePipe],
  template: `
    <fh-person-picker #picker [familyId]="familyId()" [label]="label()" [exclude]="excluded()" (picked)="add($event)" />
    @if (value().length) {
      <ul class="mt-2 flex flex-wrap gap-2" [attr.aria-label]="label()">
        @for (p of value(); track p.id) {
          <li class="flex items-center gap-1.5 rounded-full border border-stone-200 bg-white py-1 pl-1 pr-2 text-sm dark:border-stone-700 dark:bg-stone-900">
            <fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" />
            {{ p.displayName }}
            <button type="button" class="rounded-full p-0.5 hover:bg-stone-100 dark:hover:bg-stone-800" (click)="remove(p)" [attr.aria-label]="'Remove {name}' | t: { name: p.displayName }">
              <svg lucideX class="size-3.5"></svg>
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class PeopleFieldComponent {
  readonly familyId = input.required<string>();
  readonly label = input(t('People'));
  readonly value = model<PersonCard[]>([]);
  private readonly picker = viewChild.required<PersonPickerComponent>('picker');
  protected readonly excluded = computed(() => this.value().map((p) => p.id));

  protected add(p: PersonCard | null): void {
    if (!p) return;
    if (!this.value().some((x) => x.id === p.id)) this.value.set([...this.value(), p]);
    queueMicrotask(() => this.picker().clear());
  }

  protected remove(p: PersonCard): void {
    this.value.set(this.value().filter((x) => x.id !== p.id));
  }
}
