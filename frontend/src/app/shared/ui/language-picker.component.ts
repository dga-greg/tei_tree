import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { LucideLanguages } from '@lucide/angular';
import { AuthApi } from '../../core/auth/auth.api';
import { AuthStore } from '../../core/auth/auth.store';
import { currentLanguage, switchLanguage } from '../../core/i18n/i18n';
import { LANGUAGES } from '../../core/i18n/languages';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Choose the interface language. Saved to the account when signed in, and on this device; the app restarts in it. */
@Component({
  selector: 'fh-language-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, LucideLanguages],
  template: `
    <label class="flex items-center gap-2">
      <svg lucideLanguages class="size-4 shrink-0 text-stone-500" aria-hidden="true"></svg>
      <span [class]="compact() ? 'sr-only' : 'label !mb-0'">{{ 'Language' | t }}</span>

      <select
        class="input !w-auto !py-1.5"
        [value]="selectedLanguage()"
        (change)="choose($any($event.target).value)"
        [disabled]="busy()"
      >
        <option value="" disabled>{{ 'Select Language' | t }}</option>

        @for (l of languages; track l.code) {
          <option [value]="l.code">
            {{ l.native }}
          </option>
        }
      </select>

      <!-- <select
        class="input !w-auto !py-1.5"
        [value]="current.code"
        (change)="choose($any($event.target).value)"
        [disabled]="busy()"
      >
        @for (l of languages; track l.code) {
          <option [value]="l.code">
            {{ l.native }}{{ l.status === 'draft' ? ' — ' + ('draft' | t) : '' }}
          </option>
        }
      </select> -->
    </label>
    @if (!compact() && current.status === 'draft') {
      <p class="mt-2 text-xs text-stone-500">
        {{
          'This translation is a draft waiting for review by native speakers. Some words may be wrong or still in English.'
            | t
        }}
      </p>
    }
  `,
})
export class LanguagePickerComponent {
  /** Just the icon and the list (for the sign-in pages). */
  readonly compact = input(false);
  private readonly auth = inject(AuthStore);
  private readonly api = inject(AuthApi);
  protected readonly languages = LANGUAGES;
  protected readonly current = currentLanguage();
  protected readonly busy = signal(false);

  protected readonly selectedLanguage = signal('');

  protected async choose(code: string): Promise<void> {
    this.busy.set(true);
    try {
      if (this.auth.isAuthenticated())
        await this.api.updateProfile({ preferences: { locale: code } });
    } catch {
      /* the device keeps the choice even if saving it to the account failed */
    }
    switchLanguage(code);
  }
}
