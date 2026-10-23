import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { LucideEye, LucideEyeOff } from '@lucide/angular';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Wraps a password `<input>` and adds a button that shows or hides what was typed:
 * `<fh-password-reveal><input class="input" type="password" … /></fh-password-reveal>`.
 */
@Component({
  selector: 'fh-password-reveal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideEye, LucideEyeOff, TranslatePipe],
  host: { class: 'relative block [&_input]:!pr-11' },
  template: `
    <ng-content />
    <button type="button" class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-stone-500 hover:text-stone-800 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-stone-400 dark:hover:text-stone-100"
            [attr.aria-label]="visible() ? ('Hide password' | t) : ('Show password' | t)" [attr.aria-pressed]="visible()" (click)="toggle()">
      @if (visible()) { <svg lucideEyeOff class="size-4.5" aria-hidden="true"></svg> } @else { <svg lucideEye class="size-4.5" aria-hidden="true"></svg> }
    </button>
  `,
})
export class PasswordRevealComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly visible = signal(false);

  protected toggle(): void {
    const field = this.host.nativeElement.querySelector('input');
    if (!field) return;
    this.visible.update((v) => !v);
    field.type = this.visible() ? 'text' : 'password';
    field.focus();
  }
}
