import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal } from '@angular/core';
import { LucideCamera } from '@lucide/angular';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { cropPhoto } from './profile-photo';

/**
 * The photo at the top of the add/edit form. Its value is the new cropped picture, `null` to remove the current one,
 * or `undefined` when unchanged; the page uploads it when the person is saved.
 */
@Component({
  selector: 'fh-profile-photo-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PersonAvatarComponent, LucideCamera, TranslatePipe],
  template: `
    <div class="flex items-center gap-4">
      <fh-person-avatar [name]="name()" [photoUrl]="shown()" size="lg" />
      <div class="min-w-0">
        <p class="label !mb-1.5">{{ 'Profile photo' | t }}</p>
        <div class="flex flex-wrap gap-2">
          <label class="btn-secondary cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500">
            <svg lucideCamera class="size-4"></svg> {{ shown() ? ('Change photo' | t) : ('Add photo' | t) }}
            <input type="file" class="sr-only" accept="image/*" data-testid="profile-photo-input" (change)="choose($any($event.target)); $any($event.target).value = ''" />
          </label>
          @if (shown()) {
            <button type="button" class="btn-ghost" (click)="value.set(current() ? null : undefined)">{{ 'Remove photo' | t }}</button>
          }
        </div>
        <p class="mt-1.5 text-xs text-stone-500">
          @if (review()) { {{ 'A moderator checks new photos before the family sees them.' | t }} }
          @else { {{ 'You can crop it after choosing it.' | t }} }
        </p>
      </div>
    </div>
  `,
})
export class ProfilePhotoFieldComponent {
  /** For the initials shown when there is no photo. */
  readonly name = input('');
  /** The person's current photo, if any. */
  readonly current = input<string | null>(null);
  /** Whether the viewer's uploads wait for a moderator. */
  readonly review = input(false);
  readonly value = model<File | null | undefined>(undefined);

  private readonly dialog = inject(Dialog);
  private readonly preview = signal<string | null>(null);
  protected readonly shown = computed(() => {
    const v = this.value();
    return v === null ? null : v ? this.preview() : this.current();
  });

  constructor() {
    effect((onCleanup) => {
      const v = this.value();
      if (!v) return this.preview.set(null);
      const url = URL.createObjectURL(v);
      this.preview.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });
  }

  protected async choose(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    const cropped = await cropPhoto(this.dialog, file);
    if (cropped) this.value.set(cropped);
  }
}
