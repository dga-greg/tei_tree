import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideDynamicIcon, LucideMapPin, LucideMegaphone, LucidePencil, LucideTrash2, LucideWallet } from '@lucide/angular';
import { ANNOUNCE_CHANNEL_LABELS, EVENT_KIND_LABELS, formatMoney, type AnnounceChannel, type AnnouncementRecipientView, type AnnouncementView, type DeliveryState, type EventView, type FundView, type MediaView } from '@fh/contracts';
import { MessagingApi } from '../../core/messaging/messaging.api';
import { AnnounceDialogComponent, type AnnounceDialogData } from './announce-dialog.component';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FamilyLifeApi } from '../../core/family-life/family-life.api';
import { paragraphs } from '../../shared/archive-format';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ConfirmDialogComponent, type ConfirmData } from '../../shared/ui/confirm-dialog.component';
import { MediaGridComponent } from '../../shared/ui/media-grid.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { MediaViewerComponent, type MediaViewerData } from '../media/media-viewer.component';
import { TIMELINE_ICONS } from '../history/timeline-kinds';

@Component({
  selector: 'fh-ceremony-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, SpinnerComponent, PersonAvatarComponent, MediaGridComponent, LucideDynamicIcon, LucideMapPin, LucideMegaphone, LucidePencil, LucideTrash2, LucideWallet, TranslatePipe],
  template: `
    <a routerLink="/ceremonies" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">← {{ 'Ceremonies' | t }}</a>
    @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }
    @if (ceremony(); as c) {
      <header class="card relative mt-3 overflow-hidden p-6 sm:p-8">
        <div class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-gold-300 via-brand-400 to-brand-700" aria-hidden="true"></div>
        <p class="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-300"><svg [lucideIcon]="icons[c.kind]" class="size-4" aria-hidden="true"></svg> {{ kindLabels[c.kind] | t }}</p>
        <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">{{ c.title }}</h1>
        <p class="mt-2 text-stone-600 dark:text-stone-300">{{ c.date ? fuzzy(c.date) : ('Date to be announced' | t) }}</p>
        @if (c.place) { <p class="mt-1 flex items-center gap-1.5 text-stone-600 dark:text-stone-300"><svg lucideMapPin class="size-4" aria-hidden="true"></svg>{{ c.place }}</p> }
        @if (c.viewerCan.edit || c.viewerCan.announce) {
          <div class="mt-4 flex flex-wrap gap-2">
            @if (c.viewerCan.announce) {
              <button type="button" class="btn-primary" (click)="announce(c)"><svg lucideMegaphone class="size-4"></svg> {{ 'Announce' | t }}</button>
            }
            @if (c.viewerCan.edit) {
              <a [routerLink]="['/ceremonies', c.id, 'edit']" class="btn-secondary"><svg lucidePencil class="size-4"></svg> {{ 'Edit' | t }}</a>
              <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="remove(c)"><svg lucideTrash2 class="size-4"></svg> {{ 'Remove' | t }}</button>
            }
          </div>
        }
        @if (notice(); as n) { <fh-alert tone="success" class="mt-4 block">{{ n }}</fh-alert> }
      </header>

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div class="space-y-6">
          @if (c.description) {
            <section class="card p-6">
              @for (p of paras(c.description); track $index) { <p class="mb-3 leading-relaxed text-stone-700 last:mb-0 dark:text-stone-300">{{ p }}</p> }
            </section>
          }
          <section class="card p-6" aria-labelledby="prog-h">
            <h2 id="prog-h" class="text-lg font-semibold">{{ 'Programme' | t }}</h2>
            @if (c.programme.length) {
              <ol class="mt-4 space-y-3 border-l-2 border-brand-200 pl-4 dark:border-brand-900">
                @for (item of c.programme; track $index) {
                  <li>
                    <p class="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">{{ item.time || '—' }}</p>
                    <p class="font-medium">{{ item.title }}</p>
                    @if (item.lead) { <p class="text-sm text-stone-500">{{ 'Led by {name}' | t: { name: item.lead } }}</p> }
                    @if (item.detail) { <p class="text-sm text-stone-600 dark:text-stone-300">{{ item.detail }}</p> }
                  </li>
                }
              </ol>
            } @else {
              <p class="mt-2 text-sm text-stone-500">{{ 'No programme yet.' | t }}</p>
            }
          </section>
          @if (c.viewerCan.announce && announcements().length) {
            <section class="card p-6" aria-labelledby="ann-h">
              <h2 id="ann-h" class="text-lg font-semibold">{{ 'Announcements' | t }}</h2>
              <ul class="mt-3 divide-y divide-stone-200 dark:divide-stone-800">
                @for (a of announcements(); track a.id) {
                  <li class="py-3">
                    <p class="text-xs text-stone-500">{{ when(a.createdAt) }} · {{ a.sentBy }} · {{ a.audience }}</p>
                    <p class="mt-1 line-clamp-2 whitespace-pre-line text-sm">{{ a.message }}</p>
                    <p class="mt-1 text-xs text-stone-600 dark:text-stone-300">
                      @if (held(a)) { {{ 'Will be sent at {time}.' | t: { time: when(a.scheduledFor!) } }} }
                      @else if (a.status !== 'sent') { {{ 'Sending…' | t }} }
                      @else { {{ delivered(a) }} }
                    </p>
                    @if (a.rsvp.enabled) {
                      <p class="mt-2 flex flex-wrap gap-2 text-xs">
                        <span class="badge bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200">{{ '{count} coming' | t: { count: a.rsvp.yes } }}</span>
                        <span class="badge bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ '{count} not coming' | t: { count: a.rsvp.no } }}</span>
                        <span class="badge bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ '{count} no answer yet' | t: { count: a.rsvp.waiting } }}</span>
                      </p>
                    }
                    <button type="button" class="mt-2 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" (click)="toggleRecipients(a)" [attr.aria-expanded]="open() === a.id">{{ open() === a.id ? ('Hide people' | t) : ('Show people' | t) }}</button>
                    @if (open() === a.id) {
                      <ul class="mt-2 space-y-1 text-sm" [attr.aria-label]="'People it went to' | t">
                        @for (r of recipients(); track r.person.id) {
                          <li class="flex flex-wrap items-center justify-between gap-2">
                            <span>{{ r.person.displayName }}@if (r.phone) { <span class="text-xs text-stone-500"> {{ r.phone }}</span> }@if (r.optedOut) { <span class="text-xs text-stone-500"> · {{ 'stopped messages' | t }}</span> }</span>
                            <span class="text-xs text-stone-500">{{ answer(r.rsvp) }} · {{ channelsOf(r.delivery) }}</span>
                          </li>
                        }
                      </ul>
                    }
                  </li>
                }
              </ul>
            </section>
          }
          <section class="card p-6" aria-labelledby="media-h">
            <h2 id="media-h" class="mb-3 text-lg font-semibold">{{ 'Photos & files' | t }}</h2>
            @if (c.media.length) { <fh-media-grid [items]="c.media" [compact]="true" (open)="view(c.media, $event)" /> }
            @else { <p class="text-sm text-stone-500">{{ 'None yet. Add photos from Photos & Documents and choose this ceremony.' | t }}</p> }
          </section>
        </div>

        <div class="space-y-6">
          @if (c.people.length) {
            <section class="card p-6" aria-labelledby="hon-h">
              <h2 id="hon-h" class="text-lg font-semibold">{{ c.kind === 'funeral' || c.kind === 'one_week' || c.kind === 'memorial' ? ('In memory of' | t) : ('Celebrating' | t) }}</h2>
              <ul class="mt-3 space-y-2">
                @for (p of c.people; track p.id) {
                  <li><a [routerLink]="['/members', p.id]" class="flex items-center gap-3 hover:underline"><fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" size="sm" />{{ p.displayName }}</a></li>
                }
              </ul>
            </section>
          }
          @if (c.roles.length) {
            <section class="card p-6" aria-labelledby="roles-h">
              <h2 id="roles-h" class="text-lg font-semibold">{{ 'Roles' | t }}</h2>
              <dl class="mt-3 space-y-3">
                @for (r of c.roles; track $index) {
                  <div>
                    <dt class="text-xs font-medium uppercase tracking-wide text-stone-500">{{ r.role }}</dt>
                    <dd>@if (r.person) { <a class="font-medium hover:underline" [routerLink]="['/members', r.person.id]">{{ r.person.displayName }}</a> } @else { {{ r.name }} }</dd>
                  </div>
                }
              </dl>
            </section>
          }
          @if (fund(); as f) {
            <section class="card p-6" aria-labelledby="fund-h">
              <h2 id="fund-h" class="flex items-center gap-2 text-lg font-semibold"><svg lucideWallet class="size-5" aria-hidden="true"></svg> {{ 'Contributions' | t }}</h2>
              <p class="mt-2 text-2xl font-semibold">{{ money(f.totals.amount, f.currency) }}</p>
              <p class="text-sm text-stone-500">{{ raised(f) }}</p>
              @if (f.target) {
                <div class="mt-3 h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800" role="progressbar" [attr.aria-valuenow]="percent(f)" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'{percent}% of the target' | t: { percent: percent(f) }">
                  <div class="h-full rounded-full bg-brand-600" [style.width.%]="percent(f)"></div>
                </div>
              }
              <a [routerLink]="['/funds', f.id]" class="btn-secondary mt-4">{{ 'Open {name}' | t: { name: f.name } }}</a>
            </section>
          }
        </div>
      </div>
    } @else if (!error()) {
      <fh-spinner class="mt-6" [showLabel]="true" />
    }
  `,
})
export class CeremonyPage {
  readonly id = input.required<string>();
  private readonly context = inject(FamilyContextStore);
  private readonly archive = inject(ArchiveApi);
  private readonly life = inject(FamilyLifeApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly ceremony = signal<EventView | null>(null);
  protected readonly fund = signal<FundView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  private readonly messaging = inject(MessagingApi);
  protected readonly announcements = signal<AnnouncementView[]>([]);
  protected readonly open = signal<string | null>(null);
  protected readonly recipients = signal<AnnouncementRecipientView[]>([]);
  protected readonly kindLabels = EVENT_KIND_LABELS;
  protected readonly icons = TIMELINE_ICONS;
  protected readonly paras = paragraphs;
  protected readonly fuzzy = formatFuzzyDate;
  protected readonly money = formatMoney;

  constructor() {
    effect(() => {
      const family = this.context.active();
      const id = this.id();
      if (family) untracked(() => void this.load(family.id, id));
    });
  }

  private async load(familyId: string, id: string): Promise<void> {
    try {
      const c = await this.archive.event(familyId, id);
      this.ceremony.set(c);
      this.fund.set(c.fund ? await this.life.fund(familyId, c.fund.id).catch(() => null) : null);
      if (c.viewerCan.announce) this.announcements.set(await this.messaging.list(familyId, id).catch(() => []));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected async announce(c: EventView): Promise<void> {
    const familyId = this.context.active()!.id;
    const ref = this.dialog.open<AnnouncementView, AnnounceDialogData>(AnnounceDialogComponent, { data: { familyId, ceremony: c } });
    const sent = await firstValueFrom(ref.closed);
    if (!sent) return;
    this.notice.set(
      this.held(sent)
        ? t('The announcement will be sent at {time}, when it is morning in Ghana.', { time: this.when(sent.scheduledFor!) })
        : t('{count, plural, one {The announcement is on its way to # person.} other {The announcement is on its way to # people.}}', { count: sent.counts.recipients }),
    );
    // Sending takes a moment; show the result when it is done.
    setTimeout(() => void this.messaging.list(familyId, c.id).then((list) => this.announcements.set(list)).catch(() => undefined), 1500);
    this.announcements.set([sent, ...this.announcements()]);
  }

  /** Waiting for the morning (written at night), not just about to go. */
  protected held(a: AnnouncementView): boolean {
    return a.status === 'scheduled' && !!a.scheduledFor && Date.parse(a.scheduledFor) > Date.now() + 60_000;
  }

  protected async toggleRecipients(a: AnnouncementView): Promise<void> {
    if (this.open() === a.id) return this.open.set(null);
    this.recipients.set(await this.messaging.recipients(this.context.active()!.id, a.id).catch(() => []));
    this.open.set(a.id);
  }

  protected when(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  }

  protected delivered(a: AnnouncementView): string {
    const c = a.counts;
    const parts = [
      c.sms ? t('{count} by SMS', { count: c.sms }) : '',
      c.whatsapp ? t('{count} by WhatsApp', { count: c.whatsapp }) : '',
      c.email ? t('{count} by e-mail', { count: c.email }) : '',
      c.push ? t('{count} by app notification', { count: c.push }) : '',
      c.failed ? t('{count} failed', { count: c.failed }) : '',
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : t('Sent');
  }

  protected answer(r: 'yes' | 'no' | null): string {
    return r === 'yes' ? t('Coming') : r === 'no' ? t('Not coming') : t('No answer yet');
  }

  protected channelsOf(delivery: Partial<Record<AnnounceChannel, DeliveryState>>): string {
    const sent = (Object.entries(delivery) as [AnnounceChannel, DeliveryState][]).filter(([, s]) => s === 'sent').map(([c]) => t(ANNOUNCE_CHANNEL_LABELS[c]));
    const failed = (Object.entries(delivery) as [AnnounceChannel, DeliveryState][]).filter(([, s]) => s === 'failed').map(([c]) => t('{channel} failed', { channel: t(ANNOUNCE_CHANNEL_LABELS[c]) }));
    return [...sent, ...failed].join(', ') || t('Not reached');
  }

  protected percent(f: FundView): number {
    return f.target ? Math.min(100, Math.round((f.totals.amount / f.target) * 100)) : 0;
  }

  protected raised(f: FundView): string {
    const count = f.totals.contributors;
    return f.target
      ? t('{count, plural, one {from # contributor, of {target} hoped for} other {from # contributors, of {target} hoped for}}', { count, target: this.money(f.target, f.currency) })
      : t('{count, plural, one {from # contributor} other {from # contributors}}', { count });
  }

  protected view(items: MediaView[], index: number): void {
    this.dialog.open<boolean, MediaViewerData>(MediaViewerComponent, { data: { familyId: this.context.active()!.id, items, index }, ariaLabel: t('File viewer') });
  }

  protected async remove(c: EventView): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog.open<boolean, ConfirmData>(ConfirmDialogComponent, {
        data: {
          title: t('Remove “{title}”?', { title: c.title }),
          message: t('The ceremony is removed from the family history and the calendar. Its photos and any fund stay. The removal is recorded in the change history.'),
          confirmLabel: t('Remove ceremony'),
          danger: true,
        },
        role: 'alertdialog',
      }).closed,
    );
    if (!ok) return;
    try {
      await this.archive.removeEvent(this.context.active()!.id, c.id);
      await this.router.navigate(['/ceremonies']);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }
}
