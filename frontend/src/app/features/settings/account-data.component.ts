import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LucideDownload } from '@lucide/angular';
import { ApiError } from '../../core/api/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LifecycleApi, type ScheduledDeletion } from '../../core/lifecycle/lifecycle.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { PasswordRevealComponent } from '../../shared/ui/password-reveal.component';

/** The person's own data: download it, restore families they are deleting, or delete the account. */
@Component({
  selector: 'fh-account-data',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, PasswordRevealComponent, FormsModule, DatePipe, AlertComponent, LucideDownload],
  template: `
    @if (deletedFamily()) {
      <fh-alert tone="info" class="mb-4 block">{{ '“{name}” is closed and will be erased on the date below. You can restore it until then.' | t: { name: deletedFamily() } }}</fh-alert>
    }
    @if (scheduled().length) {
      <section class="card mb-6 p-6" aria-labelledby="sched-h">
        <h2 id="sched-h" class="text-lg font-semibold">{{ 'Families being deleted' | t }}</h2>
        <ul class="mt-3 divide-y divide-stone-200 dark:divide-stone-800">
          @for (f of scheduled(); track f.id) {
            <li class="flex flex-wrap items-center gap-3 py-2">
              <span class="flex-1"><strong>{{ f.name }}</strong> <span class="text-sm text-stone-500">{{ 'will be erased on {date}' | t: { date: (f.deletionScheduledFor | date: 'longDate') } }}</span></span>
              <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="restore(f)">{{ 'Restore the family' | t }}</button>
            </li>
          }
        </ul>
      </section>
    }
    <div class="grid gap-6 lg:grid-cols-2">
      <section class="card space-y-3 p-6" aria-labelledby="mydata-h">
        <h2 id="mydata-h" class="text-lg font-semibold">{{ 'Your data' | t }}</h2>
        <p class="text-sm text-stone-600 dark:text-stone-300">{{ 'Download everything this site holds about your account: profile, families you belong to, your suggestions, uploads, stories, devices and activity.' | t }}</p>
        <a class="btn-secondary" [href]="lifecycle.accountExportUrl" download><svg lucideDownload class="size-4"></svg> {{ 'Download my data' | t }}</a>
      </section>
      <section class="card space-y-3 border-red-200 p-6 dark:border-red-900" aria-labelledby="delacct-h">
        <h2 id="delacct-h" class="text-lg font-semibold text-red-800 dark:text-red-300">{{ 'Delete your account' | t }}</h2>
        <p class="text-sm text-stone-600 dark:text-stone-300">
          {{ "Your name, e-mail address and password are erased and you leave every family. People and stories you added stay with the families, shown as added by a “Former member”. Anything still waiting for review is withdrawn. If you are a family's only administrator, appoint another first." | t }}
        </p>
        @if (error(); as e) { <fh-alert>{{ e }}</fh-alert> }
        <form class="flex flex-wrap items-end gap-3" (submit)="$event.preventDefault(); deleteAccount()">
          <div class="min-w-48 flex-1">
            <label class="label" for="acct-pw">{{ 'Your password' | t }}</label>
            <fh-password-reveal><input id="acct-pw" class="input" type="password" name="password" autocomplete="current-password" [(ngModel)]="password" /></fh-password-reveal>
          </div>
          <button type="submit" class="btn-danger" [disabled]="busy() || !password">{{ 'Delete my account' | t }}</button>
        </form>
      </section>
    </div>
  `,
})
export class AccountDataComponent {
  /** Name of a family just scheduled for deletion (query parameter). */
  readonly deletedFamily = input<string | undefined>();
  protected readonly lifecycle = inject(LifecycleApi);
  private readonly auth = inject(AuthStore);
  private readonly families = inject(FamilyContextStore);
  private readonly router = inject(Router);
  protected readonly scheduled = signal<ScheduledDeletion[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected password = '';

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.scheduled.set(await this.lifecycle.scheduledDeletions().catch(() => []));
  }

  protected async restore(f: ScheduledDeletion): Promise<void> {
    try {
      await this.lifecycle.cancelFamilyDeletion(f.id);
      await this.families.load();
      await this.load();
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected async deleteAccount(): Promise<void> {
    if (!confirm(t('Delete your account now? This cannot be undone.'))) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.lifecycle.deleteAccount(this.password);
      this.families.clear();
      this.auth.setUser(null);
      await this.router.navigate(['/auth/login'], { queryParams: { reason: 'deleted' } });
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.password = '';
      this.busy.set(false);
    }
  }
}
