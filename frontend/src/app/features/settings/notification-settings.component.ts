import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideBell, LucideDownload, LucideMail, LucideSmartphone } from '@lucide/angular';
import { CALENDAR_KINDS, CALENDAR_KIND_LABELS, type DigestPreview, type NotificationPreferences, type PushStatus } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { CalendarApi } from '../../core/calendar/calendar.api';
import { AppInstallService } from '../../core/pwa/app-install.service';
import { AlertComponent } from '../../shared/ui/alert.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

/** Reminders (weekly e-mail, notifications on this device) and installing the app. */
@Component({
  selector: 'fh-notification-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, FormsModule, AlertComponent, SpinnerComponent, LucideBell, LucideDownload, LucideMail, LucideSmartphone],
  template: `
    <section id="notifications" class="card scroll-mt-20 p-6" aria-labelledby="notif-h">
      <h2 id="notif-h" class="flex items-center gap-2 text-lg font-semibold"><svg lucideBell class="size-5" aria-hidden="true"></svg> {{ 'Reminders' | t }}</h2>
      <p class="mt-1 text-sm text-stone-500">{{ 'Be reminded of birthdays, anniversaries and days of remembrance in your families. Reminders arrive in the morning where you live.' | t }}</p>

      @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }
      @if (notice(); as n) { <fh-alert tone="success" class="mt-4 block">{{ n }}</fh-alert> }

      @if (!prefs()) {
        <fh-spinner class="mt-4" />
      } @else {
        <div class="mt-5 grid gap-6 lg:grid-cols-2">
          <div class="space-y-4">
            <label class="flex items-start gap-3 text-sm">
              <input type="checkbox" class="mt-1 accent-brand-700" [(ngModel)]="draft.weeklyDigest" />
              <span><strong class="flex items-center gap-1.5"><svg lucideMail class="size-4" aria-hidden="true"></svg> {{ 'Weekly e-mail' | t }}</strong>
                {{ 'Every Monday: the week ahead in each of your families, and what was added in the past week.' | t }}</span>
            </label>
            <fieldset>
              <legend class="label">{{ 'Remind me of' | t }}</legend>
              @for (k of kinds; track k) {
                <label class="mt-1 flex items-center gap-2 text-sm"><input type="checkbox" class="accent-brand-700" [(ngModel)]="draft.kinds[k]" [name]="'k-' + k" /> {{ labels[k] | t }}</label>
              }
            </fieldset>
            <div>
              <label class="label" for="tz">{{ 'Time zone' | t }}</label>
              <select id="tz" class="input" [(ngModel)]="draft.timezone">
                @for (z of zones; track z) { <option [value]="z">{{ z === deviceZone ? ('{zone} (this device)' | t: { zone: z }) : z }}</option> }
              </select>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-primary" (click)="save()" [disabled]="busy()">{{ 'Save reminders' | t }}</button>
              <button type="button" class="btn-secondary" (click)="preview()" [disabled]="busy()">{{ "Preview this week's e-mail" | t }}</button>
            </div>
            @if (digest(); as d) {
              <div class="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900">
                @if (d.hasContent) {
                  <p class="text-sm font-semibold">{{ d.subject }}</p>
                  <pre class="mt-2 whitespace-pre-wrap font-sans text-sm text-stone-700 dark:text-stone-300">{{ d.text }}</pre>
                } @else {
                  <p class="text-sm text-stone-600 dark:text-stone-300">{{ 'Nothing to tell this week, so no e-mail would be sent.' | t }}</p>
                }
              </div>
            }
          </div>

          <div class="space-y-5">
            <div>
              <h3 class="flex items-center gap-1.5 font-semibold"><svg lucideSmartphone class="size-4" aria-hidden="true"></svg> {{ 'Notifications on this device' | t }}</h3>
              @if (!push()?.publicKey) {
                <p class="mt-1 text-sm text-stone-500">{{ 'Notifications are not set up on this server yet.' | t }}</p>
              } @else if (!install.pushSupported) {
                <p class="mt-1 text-sm text-stone-500">
                  {{ 'This browser cannot receive notifications here.' | t }}
                  @if (install.isIos && !install.installed()) { {{ 'On iPhone and iPad, add the app to your home screen first (below), then turn them on from the app.' | t }} }
                </p>
              } @else {
                <p class="mt-1 text-sm text-stone-500">{{ 'A notification in the morning when something is happening that day.' | t }}
                  @if (push()!.devices) { {{ devicesText(push()!.devices) }} }</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  @if (thisDevice()) {
                    <button type="button" class="btn-secondary" (click)="testPush()" [disabled]="busy()">{{ 'Send a test' | t }}</button>
                    <button type="button" class="btn-secondary" (click)="disablePush()" [disabled]="busy()">{{ 'Turn off on this device' | t }}</button>
                  } @else {
                    <button type="button" class="btn-primary" (click)="enablePush()" [disabled]="busy()">{{ 'Turn on for this device' | t }}</button>
                  }
                </div>
              }
            </div>

            <div>
              <h3 class="flex items-center gap-1.5 font-semibold"><svg lucideDownload class="size-4" aria-hidden="true"></svg> {{ 'Install the app' | t }}</h3>
              @if (install.installed()) {
                <p class="mt-1 text-sm text-stone-500">{{ 'You are using the installed app.' | t }}</p>
              } @else if (install.canInstall()) {
                <p class="mt-1 text-sm text-stone-500">{{ 'Add Family Heritage to your home screen or desktop. It opens in its own window, like any other app.' | t }}</p>
                <button type="button" class="btn-primary mt-3" (click)="install.install()">{{ 'Install Family Heritage' | t }}</button>
              } @else if (install.isIos) {
                <p class="mt-1 text-sm text-stone-500">{{ 'In Safari, tap' | t }} <strong>{{ 'Share' | t }}</strong>{{ ', then' | t }} <strong>{{ 'Add to Home Screen' | t }}</strong>.</p>
              } @else {
                <p class="mt-1 text-sm text-stone-500">{{ "Open the browser's menu and choose" | t }} <strong>{{ 'Install app' | t }}</strong> {{ 'or' | t }} <strong>{{ 'Add to Home screen' | t }}</strong>.</p>
              }
            </div>
          </div>
        </div>
      }
    </section>
  `,
})
export class NotificationSettingsComponent {
  private readonly api = inject(CalendarApi);
  protected readonly install = inject(AppInstallService);

  protected readonly kinds = CALENDAR_KINDS;
  protected readonly labels = CALENDAR_KIND_LABELS;
  protected readonly deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  protected readonly zones: string[];
  protected readonly prefs = signal<NotificationPreferences | null>(null);
  protected readonly push = signal<PushStatus | null>(null);
  protected readonly thisDevice = signal(false);
  protected readonly digest = signal<DigestPreview | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected draft!: NotificationPreferences;

  constructor() {
    const all = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    this.zones = [...new Set(['UTC', this.deviceZone, ...all])];
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const [prefs, push, mine] = await Promise.all([this.api.preferences(), this.api.pushStatus(), this.install.subscribed()]);
      // Someone who never chose a time zone gets this device's.
      this.draft = structuredClone(prefs.timezone === 'UTC' && this.deviceZone ? { ...prefs, timezone: this.deviceZone } : prefs);
      this.prefs.set(prefs);
      this.push.set(push);
      this.thisDevice.set(mine);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  private async run(task: () => Promise<string | void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const message = await task();
      if (message) this.notice.set(message);
    } catch (err) {
      this.error.set(err instanceof Error && !('status' in err) ? err.message : ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected save(): Promise<void> {
    return this.run(async () => {
      const saved = await this.api.setPreferences({ ...this.draft, push: this.draft.push || this.thisDevice() });
      this.prefs.set(saved);
      this.draft = structuredClone(saved);
      return t('Reminders saved.');
    });
  }

  protected preview(): Promise<void> {
    return this.run(async () => {
      this.digest.set(await this.api.digestPreview());
    });
  }

  protected enablePush(): Promise<void> {
    return this.run(async () => {
      try {
        await this.install.enablePush(this.push()!.publicKey!);
      } catch (err) {
        if (err instanceof Error && /denied|permission/i.test(err.message)) throw new Error(t('Notifications are blocked for this site. Allow them in the browser settings, then try again.'));
        throw err;
      }
      this.thisDevice.set(true);
      this.push.set(await this.api.pushStatus());
      this.draft.push = true;
      return t('Notifications are on for this device.');
    });
  }

  protected disablePush(): Promise<void> {
    return this.run(async () => {
      await this.install.disablePush();
      this.thisDevice.set(false);
      this.push.set(await this.api.pushStatus());
      return t('Notifications are off for this device.');
    });
  }

  protected devicesText(count: number): string {
    return t('{count, plural, one {You receive them on # device.} other {You receive them on # devices.}}', { count });
  }

  protected testPush(): Promise<void> {
    return this.run(async () => {
      const { sent } = await this.api.testPush();
      return t('{count, plural, one {Test sent to # device.} other {Test sent to # devices.}}', { count: sent });
    });
  }
}
