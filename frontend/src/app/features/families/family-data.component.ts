import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideDownload, LucideTriangleAlert } from '@lucide/angular';
import type { FamilyView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { LifecycleApi } from '../../core/lifecycle/lifecycle.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { PasswordRevealComponent } from '../../shared/ui/password-reveal.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Exporting the family's records, and deleting the family (administrators). */
@Component({
  selector: 'fh-family-data',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PasswordRevealComponent, FormsModule, AlertComponent, LucideDownload, LucideTriangleAlert, TranslatePipe],
  template: `
    <div class="grid gap-6 xl:grid-cols-2">
      <section class="card space-y-4 p-6" aria-labelledby="export-h">
        <h2 id="export-h" class="text-lg font-semibold">{{ 'Download a copy' | t }}</h2>
        <p class="text-sm text-stone-600 dark:text-stone-300">
          {{ 'Everyone in the family tree, their relationships, branches, events, stories and file details.' | t }}
          <strong>GEDCOM</strong> {{ 'opens in other genealogy programs;' | t }} <strong>JSON</strong> {{ 'is a complete backup of what this site holds.' | t }} <!-- i18n-ignore -->
          {{ 'Photographs and documents themselves are downloaded from Photos & documents.' | t }}
        </p>
        <fieldset>
          <legend class="label">{{ 'Living people' | t }}</legend>
          <label class="flex items-start gap-2 text-sm"><input type="radio" name="living" value="include" class="mt-1 accent-brand-700" [(ngModel)]="living" /> {{ "Include everything (for the family's own backup)" | t }}</label>
          <label class="mt-1 flex items-start gap-2 text-sm"><input type="radio" name="living" value="private" class="mt-1 accent-brand-700" [(ngModel)]="living" /> {{ 'Replace living people with “Living” (for sharing outside the family)' | t }}</label>
        </fieldset>
        <div class="flex flex-wrap gap-2">
          <a class="btn-secondary" [href]="lifecycle.familyExportUrl(family().id, 'gedcom', living)" download><svg lucideDownload class="size-4"></svg> GEDCOM (.ged)</a> <!-- i18n-ignore -->
          <a class="btn-secondary" [href]="lifecycle.familyExportUrl(family().id, 'json', living)" download><svg lucideDownload class="size-4"></svg> {{ 'JSON backup' | t }}</a>
        </div>
        <p class="text-xs text-stone-500">{{ 'Exports are recorded in the change history.' | t }}</p>
      </section>

      <section class="card space-y-4 border-red-200 p-6 dark:border-red-900" aria-labelledby="delete-h">
        <h2 id="delete-h" class="flex items-center gap-2 text-lg font-semibold text-red-800 dark:text-red-300"><svg lucideTriangleAlert class="size-5" aria-hidden="true"></svg> {{ 'Delete the family' | t }}</h2>
        <p class="text-sm text-stone-600 dark:text-stone-300">
          {{ 'The family closes for everyone at once. During a grace period (30 days unless the platform sets otherwise) its administrators can restore it from their account settings; after that every person, story, photo and document is erased and cannot be recovered. Download a copy first.' | t }}
        </p>
        @if (error(); as e) { <fh-alert>{{ e }}</fh-alert> }
        <form class="space-y-3" (submit)="$event.preventDefault(); remove()">
          <div>
            <label class="label" for="del-name">{{ confirmParts()[0] }}<strong>{{ family().name }}</strong>{{ confirmParts()[1] }}</label>
            <input id="del-name" class="input" name="name" autocomplete="off" [(ngModel)]="name" />
          </div>
          <div>
            <label class="label" for="del-pw">{{ 'Your password' | t }}</label>
            <fh-password-reveal><input id="del-pw" class="input" type="password" name="password" autocomplete="current-password" [(ngModel)]="password" /></fh-password-reveal>
          </div>
          <button type="submit" class="btn-danger" [disabled]="busy() || name !== family().name || !password">{{ 'Delete the family' | t }}</button>
        </form>
      </section>
    </div>
  `,
})
export class FamilyDataComponent {
  /** "Type <name> to confirm" as one sentence for translators, with the name in bold where it falls. */
  protected confirmParts(): [string, string] {
    const [before = '', after = ''] = t('Type {name} to confirm', { name: '\u0000' }).split('\u0000');
    return [before, after];
  }

  readonly family = input.required<FamilyView>();
  protected readonly lifecycle = inject(LifecycleApi);
  private readonly context = inject(FamilyContextStore);
  private readonly router = inject(Router);
  protected living: 'include' | 'private' = 'include';
  protected name = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async remove(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.lifecycle.scheduleFamilyDeletion(this.family().id, this.name, this.password);
      await this.context.load();
      await this.router.navigate(['/settings'], { queryParams: { deleted: this.family().name } });
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.password = '';
      this.busy.set(false);
    }
  }
}
