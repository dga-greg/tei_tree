import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { LucideMegaphone, LucideMessageCircle } from '@lucide/angular';
import { composeAnnouncement, DEFAULT_MESSAGE_TEMPLATE, type AnnounceChannel, type AnnouncementPreview, type AnnouncementRequest, type AnnouncementView, type BranchView, type EventView, type MessagingStatus, type PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MessagingApi, type AnnouncementWords } from '../../core/messaging/messaging.api';
import { TreeApi } from '../../core/tree/tree.api';
import { formatFuzzyDate } from '../../shared/format';
import { AlertComponent } from '../../shared/ui/alert.component';
import { PeopleFieldComponent } from '../../shared/ui/people-field.component';

export interface AnnounceDialogData {
  familyId: string;
  ceremony: EventView;
}

type AudienceKind = 'all' | 'branch' | 'people';

/** Announces a ceremony to relatives by SMS, WhatsApp, e-mail and app notification, with a preview of who it reaches. */
@Component({
  selector: 'fh-announce-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PeopleFieldComponent, AlertComponent, LucideMegaphone, LucideMessageCircle, TranslatePipe],
  host: { class: 'block card max-h-[92dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <h2 class="flex items-center gap-2 text-xl font-semibold"><svg lucideMegaphone class="size-5 text-brand-700" aria-hidden="true"></svg> {{ 'Announce “{title}”' | t: { title: data.ceremony.title } }}</h2>
    <p class="mt-1 text-sm text-stone-500">{{ 'Each person gets a personal link to say whether they are coming. They can also stop messages there.' | t }}</p>

    <fieldset class="mt-5">
      <legend class="label">{{ 'Who should get it?' | t }}</legend>
      <div class="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label class="flex items-center gap-2"><input type="radio" name="audience" class="accent-brand-700" [checked]="audience() === 'all'" (change)="audience.set('all')" /> {{ 'Everyone in the family' | t }}</label>
        <label class="flex items-center gap-2"><input type="radio" name="audience" class="accent-brand-700" [checked]="audience() === 'branch'" (change)="audience.set('branch')" [disabled]="!branches().length" /> {{ 'A branch' | t }}</label>
        <label class="flex items-center gap-2"><input type="radio" name="audience" class="accent-brand-700" [checked]="audience() === 'people'" (change)="audience.set('people')" /> {{ 'Chosen people' | t }}</label>
      </div>
      @if (audience() === 'branch') {
        <select class="input mt-3" [attr.aria-label]="'Branch' | t" [value]="branchId()" (change)="branchId.set($any($event.target).value)">
          @for (b of branches(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
        </select>
      }
      @if (audience() === 'people') {
        <div class="mt-3"><fh-people-field [familyId]="data.familyId" [label]="'People to tell' | t" [(value)]="people" /></div>
      }
      <p class="mt-2 text-xs text-stone-500">{{ 'Only living relatives are included.' | t }}</p>
    </fieldset>

    <fieldset class="mt-5">
      <legend class="label">{{ 'How?' | t }}</legend>
      <div class="mt-1 grid gap-2 text-sm sm:grid-cols-2">
        <label class="flex items-start gap-2" [class.opacity-60]="!status()?.sms">
          <input type="checkbox" class="mt-0.5 accent-brand-700" [checked]="has('sms')" (change)="toggle('sms', $any($event.target).checked)" [disabled]="!status()?.sms" />
          <span>{{ 'SMS' | t }}<span class="block text-xs text-stone-500">{{ status()?.sms ? ('Reaches any phone, even without internet.' | t) : ('Not set up on this server yet.' | t) }}</span></span>
        </label>
        <label class="flex items-start gap-2" [class.opacity-60]="!status()?.whatsapp">
          <input type="checkbox" class="mt-0.5 accent-brand-700" [checked]="has('whatsapp')" (change)="toggle('whatsapp', $any($event.target).checked)" [disabled]="!status()?.whatsapp" />
          <span>{{ 'WhatsApp' | t }}<span class="block text-xs text-stone-500">{{ status()?.whatsapp ? ('Sent from the family’s WhatsApp number.' | t) : ('Not set up yet: use “Share on WhatsApp” below.' | t) }}</span></span>
        </label>
        <label class="flex items-start gap-2">
          <input type="checkbox" class="mt-0.5 accent-brand-700" [checked]="has('email')" (change)="toggle('email', $any($event.target).checked)" />
          <span>{{ 'E-mail' | t }}<span class="block text-xs text-stone-500">{{ 'To relatives with an account.' | t }}</span></span>
        </label>
        <label class="flex items-start gap-2">
          <input type="checkbox" class="mt-0.5 accent-brand-700" [checked]="has('push')" (change)="toggle('push', $any($event.target).checked)" />
          <span>{{ 'App notification' | t }}<span class="block text-xs text-stone-500">{{ 'On the phones and computers where they turned notifications on.' | t }}</span></span>
        </label>
      </div>
    </fieldset>

    <div class="mt-5">
      <label class="label" for="ann-message">{{ 'Message' | t }}</label>
      <textarea id="ann-message" class="input min-h-28" maxlength="600" [value]="message()" (input)="message.set($any($event.target).value)"></textarea>
      <p class="mt-1 text-xs text-stone-500">
        {{ '{count, plural, one {# character} other {# characters}}' | t: { count: message().length } }}@if (preview(); as p) { @if (has('sms')) { · {{ '{count, plural, one {# SMS per person, with the link} other {# SMS per person, with the link}}' | t: { count: p.smsParts } }} } }
      </p>
    </div>

    <div class="mt-4 space-y-2 text-sm">
      <label class="flex items-center gap-2"><input type="checkbox" class="accent-brand-700" [checked]="rsvp()" (change)="rsvp.set($any($event.target).checked)" /> {{ 'Ask who is coming' | t }}</label>
      <label class="flex items-center gap-2" [class.opacity-60]="!dated">
        <input type="checkbox" class="accent-brand-700" [checked]="remind()" (change)="remind.set($any($event.target).checked)" [disabled]="!dated" />
        {{ 'Remind them the day before' | t }}@if (!dated) { <span class="text-xs text-stone-500">({{ 'needs a full date' | t }})</span> }
      </label>
    </div>

    @if (preview(); as p) {
      <section class="mt-5 rounded-xl bg-brand-50 p-4 text-sm dark:bg-brand-950" aria-live="polite" [attr.aria-label]="'Who it reaches' | t">
        <p class="font-semibold">{{ '{count, plural, one {Reaches # person} other {Reaches # people}}' | t: { count: p.recipients } }}</p>
        <p class="mt-1 text-stone-600 dark:text-stone-300">{{ reachLine(p) }}</p>
        @if (has('sms') || has('email')) {
          <p class="mt-3 text-xs font-medium text-stone-500">{{ 'How it will read' | t }}</p>
          <p class="mt-1 whitespace-pre-line rounded-lg bg-white p-2.5 text-stone-800 dark:bg-stone-900 dark:text-stone-200" data-testid="announce-text">{{ readable(p.text) }}</p>
        }
        @if (p.bySms) { <p class="mt-1 text-stone-600 dark:text-stone-300">{{ 'SMS cost: about GH₵{amount}' | t: { amount: cedis(p.smsCostPesewas) } }}</p> }
        @if (p.heldUntil) { <p class="mt-1 text-stone-600 dark:text-stone-300">{{ 'It is night in Ghana: it will be sent at {time}.' | t: { time: time(p.heldUntil) } }}</p> }
        @if (p.optedOut) { <p class="mt-1 text-stone-600 dark:text-stone-300">{{ '{count, plural, one {# person asked not to get SMS or WhatsApp messages.} other {# people asked not to get SMS or WhatsApp messages.}}' | t: { count: p.optedOut } }}</p> }
        @if (p.unreachable.length) {
          <details class="mt-2">
            <summary class="cursor-pointer font-medium text-gold-700 dark:text-gold-300">{{ '{count, plural, one {# person cannot be reached this way} other {# people cannot be reached this way}}' | t: { count: p.unreachable.length } }}</summary>
            <p class="mt-1 text-xs text-stone-500">{{ 'They have no phone number or account. Call them, or add their numbers to their profiles.' | t }}</p>
            <p class="mt-1">{{ names(p.unreachable) }}</p>
          </details>
        }
      </section>
    }

    @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }

    <div class="mt-6 flex flex-wrap items-center justify-between gap-2">
      <a class="btn-secondary" [href]="whatsAppLink()" target="_blank" rel="noopener"><svg lucideMessageCircle class="size-4"></svg> {{ 'Share on WhatsApp' | t }}</a>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" (click)="ref.close()" [disabled]="busy()">{{ 'Cancel' | t }}</button>
        <button type="button" class="btn-primary" (click)="send()" [disabled]="busy() || !canSend()">
          {{ busy() ? ('Sending…' | t) : ('{count, plural, one {Send to # person} other {Send to # people}}' | t: { count: preview()?.recipients ?? 0 }) }}
        </button>
      </div>
    </div>
  `,
})
export class AnnounceDialogComponent {
  protected readonly data = inject<AnnounceDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<AnnouncementView>>(DialogRef);
  private readonly api = inject(MessagingApi);
  private readonly families = inject(FamilyContextStore);

  protected readonly status = signal<MessagingStatus | null>(null);
  protected readonly branches = signal<BranchView[]>([]);
  protected readonly audience = signal<AudienceKind>('all');
  protected readonly branchId = signal('');
  protected readonly people = signal<PersonCard[]>([]);
  protected readonly channels = signal<AnnounceChannel[]>(['email', 'push']);
  protected readonly message = signal(this.defaultMessage());
  protected readonly rsvp = signal(true);
  /** Reminders need a full date. */
  protected readonly dated = !!(this.data.ceremony.date?.day && (!this.data.ceremony.date.qualifier || this.data.ceremony.date.qualifier === 'exact'));
  protected readonly remind = signal(this.dated);
  protected readonly preview = signal<AnnouncementPreview | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly request = computed<(AnnouncementRequest & AnnouncementWords) | null>(() => {
    const kind = this.audience();
    const audience = kind === 'branch' ? (this.branchId() ? { kind, branchId: this.branchId() } : null) : kind === 'people' ? (this.people().length ? { kind, memberIds: this.people().map((p) => p.id) } : null) : { kind };
    if (!audience || !this.channels().length || !this.message().trim()) return null;
    const c = this.data.ceremony;
    return {
      audience: audience as AnnouncementRequest['audience'],
      channels: this.channels(),
      message: this.message().trim(),
      rsvp: this.rsvp(),
      remind: this.dated && this.remind(),
      linkLabel: this.rsvp() ? t('Are you coming? Answer here:') : t('Details:'),
      reminderMessage: c.place ? t('Reminder: {title} is tomorrow, {place}.', { title: c.title, place: c.place }) : t('Reminder: {title} is tomorrow.', { title: c.title }),
    };
  });
  protected readonly canSend = computed(() => !!this.request() && (this.preview()?.recipients ?? 0) > 0);
  /** The preview's sample personal link, shortened: each person gets their own. */
  protected readable(text: string): string {
    return text.replace(/\/r\/x+/, '/r/…');
  }

  /** For the family's WhatsApp group: the message with the family's opening and sign-off, no personal link. */
  protected readonly whatsAppLink = computed(() => {
    const family = this.families.details();
    const text = composeAnnouncement({
      template: family?.messageTemplate ?? DEFAULT_MESSAGE_TEMPLATE,
      familyName: family?.name ?? this.families.active()?.name ?? '',
      message: this.message(),
      linkLine: '',
    });
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  });

  constructor() {
    void this.api.status(this.data.familyId).then((s) => {
      this.status.set(s);
      // SMS and WhatsApp on by default where they work: they reach relatives who never sign in.
      this.channels.set([...(s.sms ? (['sms'] as const) : []), ...(s.whatsapp ? (['whatsapp'] as const) : []), 'email', 'push']);
    });
    void inject(TreeApi)
      .branches(this.data.familyId)
      .then((b) => {
        this.branches.set(b);
        if (b[0]) this.branchId.set(b[0].id);
      })
      .catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const body = this.request();
      clearTimeout(timer);
      if (!body) return untracked(() => this.preview.set(null));
      timer = setTimeout(() => {
        this.api.preview(this.data.familyId, this.data.ceremony.id, body).then(
          (p) => {
            this.preview.set(p);
            this.error.set(null);
          },
          (err: unknown) => this.error.set(ApiError.from(err).message),
        );
      }, 350);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  private defaultMessage(): string {
    const c = this.data.ceremony;
    const when = c.date ? formatFuzzyDate(c.date) : '';
    return [c.title, [when, c.place].filter(Boolean).join(', ')].filter(Boolean).join('\n');
  }

  protected has(c: AnnounceChannel): boolean {
    return this.channels().includes(c);
  }

  protected toggle(c: AnnounceChannel, on: boolean): void {
    this.channels.set(on ? [...new Set([...this.channels(), c])] : this.channels().filter((x) => x !== c));
  }

  protected reachLine(p: AnnouncementPreview): string {
    const parts = [
      this.has('sms') ? t('{count} by SMS', { count: p.bySms }) : '',
      this.has('whatsapp') ? t('{count} by WhatsApp', { count: p.byWhatsapp }) : '',
      this.has('email') ? t('{count} by e-mail', { count: p.byEmail }) : '',
      this.has('push') ? t('{count} by app notification', { count: p.byPush }) : '',
    ];
    return parts.filter(Boolean).join(' · ');
  }

  protected cedis(pesewas: number): string {
    return (pesewas / 100).toFixed(2);
  }

  protected time(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  protected names(people: PersonCard[]): string {
    return people.map((p) => p.displayName).join(', ');
  }

  protected async send(): Promise<void> {
    const body = this.request();
    if (!body) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.ref.close(await this.api.send(this.data.familyId, this.data.ceremony.id, body));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
