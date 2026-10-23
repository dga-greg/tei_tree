import { createHash, createHmac } from 'node:crypto';
import { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  ANNOUNCE_CHANNELS,
  composeAnnouncement,
  composeAnnouncementLine,
  formatFuzzyDate,
  type AnnounceChannel,
  type AnnouncementPreview,
  type AnnouncementRecipientView,
  type AnnouncementView,
  type MessagingStatus,
  type RsvpAnswer,
  type RsvpView,
} from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { objectId } from '../../core/validation.js';
import { maskPhone, normalisePhone, smsParts, type SmsSender, type WhatsAppSender } from '../../infra/messaging.js';
import type { PushMessage } from '../../infra/push.js';
import { QUEUE_NAMES, type EmailDispatcher } from '../../infra/queues.js';
import type { Redis } from '../../infra/redis.js';
import { assertPeople } from '../archive/archive.shared.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import type { AuditService } from '../audit/audit.service.js';
import { FamilyEventModel, type FamilyEventDoc } from '../events/event.model.js';
import { mayAnnounce } from '../events/events.service.js';
import type { FamilyAccess } from '../families/family-access.js';
import { messageTemplateOf } from '../families/family.mapper.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { FamilyMemberModel, type FamilyMemberDoc } from '../members/member.model.js';
import { MemberPolicy } from '../members/member.policy.js';
import { localTime } from '../notifications/notifications.service.js';
import type { Actor } from '../relationships/relationships.service.js';
import { UserModel } from '../users/user.model.js';
import { AnnouncementModel, type AnnouncementDoc } from './announcement.model.js';

const MAX_RECIPIENTS = 2000;
/** The family an announcement comes from, as its text names it. */
type Sender = { name: string; messageTemplate?: { opening?: string | null; signOff?: string | null } | null };

/** Night in Ghana: from 21:00 messages wait until 07:00. */
const QUIET_FROM = 21;
const QUIET_UNTIL = 7;
/** The day-before reminder goes out at this hour, local time. */
const REMINDER_HOUR = 9;
const DAY_MS = 86_400_000;

export const announcementBody = z
  .object({
    audience: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('all') }).strict(),
      z.object({ kind: z.literal('branch'), branchId: objectId }).strict(),
      z.object({ kind: z.literal('people'), memberIds: z.array(objectId).min(1).max(MAX_RECIPIENTS) }).strict(),
    ]),
    channels: z.array(z.enum(ANNOUNCE_CHANNELS)).min(1, 'Choose at least one way to send it').max(4),
    message: z.string().trim().min(1, 'Write the message').max(600),
    rsvp: z.boolean().default(true),
    remind: z.boolean().default(false),
    /** The words before the personal link, in the sender's language ("Are you coming? Answer here:"). */
    linkLabel: z.string().trim().max(80).optional(),
    /** The reminder, in the sender's language. */
    reminderMessage: z.string().trim().max(300).optional(),
  })
  .strict();
type AnnouncementInput = z.output<typeof announcementBody>;

export const rsvpTokenBody = z.object({ token: z.string().min(10).max(100) }).strict();
export const rsvpAnswerBody = z.object({ token: z.string().min(10).max(100), answer: z.enum(['yes', 'no', 'stop', 'start']) }).strict();

export interface AnnouncementSettings {
  appOrigin: string;
  /** Signs personal links, so they need not be stored. */
  secret: string;
  smsPricePesewas: number;
  smsMonthlyLimit: number;
  timezone: string;
  /** Hold messages written at night until the morning. */
  quietHours: boolean;
}

/** Notifications on people's devices (NotificationsService). */
export interface DevicePush {
  pushTo(userId: Types.ObjectId, message: PushMessage): Promise<number>;
}

/** People in a branch (BranchesService). */
export interface BranchMembers {
  memberIds(access: FamilyAccess, branchId: Types.ObjectId): Promise<Types.ObjectId[]>;
}

interface Reach {
  person: FamilyMemberDoc;
  phone: string | null;
  optedOut: boolean;
  userId: Types.ObjectId | null;
  email: string | null;
  channels: AnnounceChannel[];
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The hour `hour` of a local day in a time zone, as a moment. */
export function localMoment(year: number, month: number, day: number, hour: number, timezone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const t = localTime(new Date(guess), timezone);
  const shown = Date.UTC(Number(t.date.slice(0, 4)), Number(t.date.slice(5, 7)) - 1, Number(t.date.slice(8, 10)), t.hour);
  return new Date(guess - (shown - guess));
}

/** When a message written now may go out: now, or 07:00 when it is night where the family lives. */
export function sendingTime(now: Date, timezone: string): Date {
  const { hour, date } = localTime(now, timezone);
  if (hour >= QUIET_UNTIL && hour < QUIET_FROM) return now;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const morning = localMoment(y, m, d, QUIET_UNTIL, timezone);
  return morning > now ? morning : localMoment(y, m, d + 1, QUIET_UNTIL, timezone);
}

/**
 * Ceremony announcements: who they reach, sending them on the chosen channels (now, or in the morning when it is
 * night), the personal links people answer through, and the reminder the day before.
 */
export class AnnouncementsService {
  private readonly queue: Queue<{ announcementId: string }> | null;
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly settings: AnnouncementSettings,
    private readonly senders: { sms: SmsSender | null; whatsapp: WhatsAppSender | null },
    private readonly email: EmailDispatcher,
    private readonly push: DevicePush,
    private readonly branches: BranchMembers,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    redis?: Redis,
  ) {
    this.queue = redis ? new Queue(QUEUE_NAMES.announcements, { connection: redis }) : null;
  }

  // ------------------------------------------------------------------ status, preview

  private monthStart(now = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  private async smsUsed(familyId: Types.ObjectId): Promise<number> {
    const [row] = await AnnouncementModel.aggregate<{ n: number }>([
      { $match: { familyId, createdAt: { $gte: this.monthStart() } } },
      { $group: { _id: null, n: { $sum: '$smsParts' } } },
    ]);
    return row?.n ?? 0;
  }

  async status(access: FamilyAccess): Promise<MessagingStatus> {
    if (!access.membership) throw AppError.forbidden();
    return {
      sms: !!this.senders.sms,
      whatsapp: !!this.senders.whatsapp,
      smsPricePesewas: this.settings.smsPricePesewas,
      smsLeftThisMonth: Math.max(0, this.settings.smsMonthlyLimit - (await this.smsUsed(access.familyId))),
      smsPartLength: 160,
    };
  }

  private async event(access: FamilyAccess, eventId: Types.ObjectId): Promise<FamilyEventDoc> {
    const e = await FamilyEventModel.findOne({ _id: eventId, familyId: access.familyId, deletedAt: null });
    if (!e) throw AppError.notFound('Ceremony');
    if (!mayAnnounce(access, e)) throw AppError.forbidden("Only administrators, moderators and the ceremony's organisers can send announcements.");
    return e;
  }

  /** The living people the audience names, as the sender may see them. */
  private async audience(access: FamilyAccess, input: AnnouncementInput): Promise<{ people: FamilyMemberDoc[]; label: string }> {
    const filter: Record<string, unknown> = { familyId: access.familyId, deletedAt: null };
    let label = 'Everyone';
    if (input.audience.kind === 'branch') {
      const ids = await this.branches.memberIds(access, new Types.ObjectId(input.audience.branchId));
      filter['_id'] = { $in: ids };
      label = (await FamilyBranchModel.findById(input.audience.branchId, { name: 1 }).lean())?.name ?? 'A branch';
    } else if (input.audience.kind === 'people') {
      filter['_id'] = { $in: await assertPeople(access, input.audience.memberIds) };
      label = `${new Set(input.audience.memberIds).size} chosen people`;
    }
    const policy = new MemberPolicy(access);
    const people = (await FamilyMemberModel.find(filter).select('+contact').limit(MAX_RECIPIENTS * 2)).filter((p) => policy.isVisible(p) && policy.presumedLiving(p));
    if (people.length > MAX_RECIPIENTS) throw new AppError('VALIDATION_FAILED', `Announcements go to at most ${MAX_RECIPIENTS} people at a time. Choose a branch or fewer people.`);
    return { people, label };
  }

  /** How each person can be reached on the chosen channels. */
  private async reach(access: FamilyAccess, people: FamilyMemberDoc[], channels: AnnounceChannel[]): Promise<Reach[]> {
    const memberships = await FamilyMembershipModel.find({ familyId: access.familyId, status: 'active', memberProfileId: { $in: people.map((p) => p._id) } }, { userId: 1, memberProfileId: 1 }).lean();
    const users = await UserModel.find({ _id: { $in: memberships.map((m) => m.userId) }, status: 'active' }, { email: 1, emailVerifiedAt: 1 }).lean();
    const account = new Map(memberships.map((m) => [m.memberProfileId!.toString(), users.find((u) => u._id.equals(m.userId))]));
    return people.map((person) => {
      const phone = normalisePhone((person.get('contact') as { phone?: string } | undefined)?.phone);
      const optedOut = !!person.messagingOptOutAt;
      const user = account.get(person.id as string);
      const email = user?.emailVerifiedAt ? user.email : null;
      const ok: Record<AnnounceChannel, boolean> = {
        sms: !!this.senders.sms && !!phone && !optedOut,
        whatsapp: !!this.senders.whatsapp && !!phone && !optedOut,
        email: !!email,
        push: !!user,
      };
      return { person, phone, optedOut, userId: user?._id ?? null, email, channels: channels.filter((c) => ok[c]) };
    });
  }

  private sendAt(now: Date): Date {
    return this.settings.quietHours ? sendingTime(now, this.settings.timezone) : now;
  }

  private sampleLink(): string {
    return `${this.settings.appOrigin}/r/${'x'.repeat(22)}`;
  }

  /** The SMS and e-mail text: the family's opening line, the message, its sign-off, then the personal link. */
  private text(family: Sender, input: { message: string; linkLabel?: string | null; rsvp?: boolean }, link: string): string {
    const label = input.linkLabel || (input.rsvp === false ? 'Details:' : 'Are you coming? Answer here:');
    return composeAnnouncement({ template: messageTemplateOf(family), familyName: family.name, message: input.message, linkLine: `${label} ${link}` });
  }

  /** WhatsApp's approved template adds the greeting and the link itself; this fills the message part. */
  private line(family: Sender, message: string): string {
    return composeAnnouncementLine({ template: messageTemplateOf(family), familyName: family.name, message });
  }

  async preview(access: FamilyAccess, eventId: Types.ObjectId, input: AnnouncementInput): Promise<AnnouncementPreview> {
    await this.event(access, eventId);
    const { people } = await this.audience(access, input);
    const reach = await this.reach(access, people, input.channels);
    const policy = new MemberPolicy(access);
    const text = this.text(access.family, input, this.sampleLink());
    const parts = smsParts(text).parts;
    const bySms = reach.filter((r) => r.channels.includes('sms')).length;
    const now = new Date();
    const at = this.sendAt(now);
    return {
      recipients: reach.filter((r) => r.channels.length).length,
      bySms,
      byWhatsapp: reach.filter((r) => r.channels.includes('whatsapp')).length,
      byEmail: reach.filter((r) => r.channels.includes('email')).length,
      byPush: reach.filter((r) => r.channels.includes('push')).length,
      unreachable: reach.filter((r) => !r.channels.length).map((r) => toPersonCard(r.person, policy)),
      optedOut: reach.filter((r) => r.optedOut && r.phone).length,
      smsParts: parts,
      smsCostPesewas: bySms * parts * this.settings.smsPricePesewas,
      text,
      heldUntil: at > now ? at.toISOString() : null,
    };
  }

  // ------------------------------------------------------------------ sending

  /** The personal link's token: derived, so it is never stored; only its hash is, to find the person again. */
  private token(announcementId: Types.ObjectId, memberId: Types.ObjectId): string {
    return createHmac('sha256', this.settings.secret).update(`announcement:${announcementId.toString()}:${memberId.toString()}`).digest('base64url').slice(0, 22);
  }

  private link(announcementId: Types.ObjectId, memberId: Types.ObjectId): string {
    return `${this.settings.appOrigin}/r/${this.token(announcementId, memberId)}`;
  }

  async create(access: FamilyAccess, actor: Actor, eventId: Types.ObjectId, input: AnnouncementInput): Promise<AnnouncementView> {
    const event = await this.event(access, eventId);
    const { people, label } = await this.audience(access, input);
    const reach = (await this.reach(access, people, input.channels)).filter((r) => r.channels.length);
    if (!reach.length) throw new AppError('VALIDATION_FAILED', 'None of these people can be reached this way. Add phone numbers, or choose other ways to send it.');

    const parts = smsParts(this.text(access.family, input, this.sampleLink())).parts;
    const smsCount = reach.filter((r) => r.channels.includes('sms')).length * parts;
    if (smsCount) {
      const left = this.settings.smsMonthlyLimit - (await this.smsUsed(access.familyId));
      if (smsCount > left) throw new AppError('CONFLICT', `This would use ${smsCount} SMS, but the family has ${Math.max(0, left)} left this month. Choose fewer people or send by WhatsApp, e-mail or app notification.`);
    }

    const now = new Date();
    const d = event.date;
    const fullDate = d?.year && d.month && d.day && (!d.qualifier || d.qualifier === 'exact');
    const remindAt = fullDate ? localMoment(d.year!, d.month!, d.day! - 1, REMINDER_HOUR, this.settings.timezone) : null;
    const closesAt = fullDate ? localMoment(d.year!, d.month!, d.day! + 2, 0, this.settings.timezone) : new Date(now.getTime() + 90 * DAY_MS);
    const id = new Types.ObjectId();
    const doc = await AnnouncementModel.create({
      _id: id,
      familyId: access.familyId,
      eventId: event._id,
      message: input.message,
      channels: input.channels,
      audience: { kind: input.audience.kind, label },
      rsvp: input.rsvp,
      remind: input.remind && !!remindAt && remindAt.getTime() > now.getTime() + 60 * 60_000,
      remindAt,
      closesAt,
      scheduledFor: this.sendAt(now),
      smsParts: smsCount,
      recipients: reach.map((r) => ({ memberId: r.person._id, phone: r.phone, userId: r.userId, tokenHash: sha256(this.token(id, r.person._id)) })),
      linkLabel: input.linkLabel ?? null,
      reminderMessage: input.reminderMessage ?? null,
      createdBy: actor.userId,
    });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'announcement.send', targetType: 'event', targetId: event._id, after: { channels: input.channels, recipients: reach.length, sms: smsCount, audience: label }, requestId: actor.requestId, ip: actor.ip });
    await this.enqueue(doc);
    return (await this.views(access, [await AnnouncementModel.findById(id).orFail()]))[0]!;
  }

  private async enqueue(doc: AnnouncementDoc): Promise<void> {
    const delay = Math.max(0, doc.scheduledFor.getTime() - Date.now());
    if (this.queue) {
      await this.queue.add('deliver', { announcementId: doc.id as string }, { delay, attempts: 1, removeOnComplete: 200, removeOnFail: 200, jobId: `announcement-${doc.id as string}` });
      return;
    }
    // Without Redis (development): send now; held ones go out with the next run of `runDue`.
    if (delay) return;
    const run = this.deliver(doc.id as string).finally(() => this.running.delete(run));
    this.running.add(run);
  }

  async idle(): Promise<void> {
    await Promise.all([...this.running]);
  }

  async close(): Promise<void> {
    await this.idle();
    await this.queue?.close();
  }

  /** Sends one announcement (worker). Safe to call twice: only one call claims it. */
  async deliver(announcementId: string): Promise<void> {
    const doc = await AnnouncementModel.findOneAndUpdate({ _id: announcementId, status: 'scheduled', scheduledFor: { $lte: new Date(Date.now() + 5000) } }, { $set: { status: 'sending' } }, { new: true });
    if (!doc) return;
    const [event, family] = await Promise.all([FamilyEventModel.findById(doc.eventId, { title: 1 }).lean(), FamilyModel.findById(doc.familyId, { name: 1, messageTemplate: 1 }).lean()]);
    const sender: Sender = family ?? { name: 'Your family' };
    const people = new Map((await FamilyMemberModel.find({ _id: { $in: doc.recipients.map((r) => r.memberId) } }, { firstName: 1, preferredName: 1, messagingOptOutAt: 1 }).lean()).map((p) => [p._id.toString(), p]));
    let smsSent = 0;
    const parts = smsParts(this.text(sender, doc, this.sampleLink())).parts;
    const results: Record<string, unknown> = {};
    await this.forEach(doc.recipients.map((r, i) => ({ r, i })), async ({ r, i }) => {
      const person = people.get(r.memberId.toString());
      const link = this.link(doc._id, r.memberId);
      const text = this.text(sender, doc, link);
      const optedOut = !!person?.messagingOptOutAt;
      const outcome = await this.sendTo(doc.channels as AnnounceChannel[], r, {
        text,
        firstName: person?.preferredName || person?.firstName || '',
        link,
        optedOut,
        subject: `${sender.name}: ${event?.title ?? 'a family ceremony'}`,
        pushTitle: `${sender.name}: ${event?.title ?? 'Family announcement'}`,
        message: doc.message,
        line: this.line(sender, doc.message),
        familyName: sender.name,
        url: `/ceremonies/${doc.eventId.toString()}`,
        tag: `announcement-${doc.id as string}`,
      });
      // Only these paths: answers may arrive while the rest is still being sent.
      results[`recipients.${i}.delivery`] = outcome.delivery;
      results[`recipients.${i}.error`] = outcome.error ?? null;
      if (outcome.delivery.sms === 'sent') smsSent += parts;
    });
    await AnnouncementModel.updateOne({ _id: doc._id }, { $set: { ...results, status: 'sent', smsParts: smsSent } });
  }

  private async forEach<T>(items: T[], fn: (item: T) => Promise<void>, concurrency = 5): Promise<void> {
    let next = 0;
    const work = async () => {
      while (next < items.length) await fn(items[next++]!);
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, work));
  }

  private async sendTo(
    channels: AnnounceChannel[],
    r: { phone?: string | null; userId?: Types.ObjectId | null },
    m: { text: string; firstName: string; link: string; optedOut: boolean; subject: string; pushTitle: string; message: string; line: string; familyName: string; url: string; tag: string },
  ): Promise<{ delivery: Partial<Record<AnnounceChannel, 'sent' | 'failed' | 'skipped'>>; error?: string }> {
    const delivery: Partial<Record<AnnounceChannel, 'sent' | 'failed' | 'skipped'>> = {};
    let error: string | undefined;
    const user = r.userId ? await UserModel.findOne({ _id: r.userId, status: 'active' }, { email: 1, emailVerifiedAt: 1 }).lean() : null;
    for (const channel of channels) {
      try {
        if (channel === 'sms' || channel === 'whatsapp') {
          const sender = channel === 'sms' ? this.senders.sms : this.senders.whatsapp;
          if (!sender || !r.phone || m.optedOut) {
            delivery[channel] = 'skipped';
            continue;
          }
          const res = channel === 'sms' ? await this.senders.sms!.send(r.phone, m.text) : await this.senders.whatsapp!.send(r.phone, { firstName: m.firstName, text: m.line, link: m.link });
          delivery[channel] = res.ok ? 'sent' : 'failed';
          if (!res.ok) error = `${channel}: ${res.error ?? 'not sent'}`.slice(0, 300);
        } else if (channel === 'email') {
          if (!user?.emailVerifiedAt) {
            delivery.email = 'skipped';
            continue;
          }
          this.email.dispatch({ to: user.email, subject: m.subject, text: `${m.text}\n\nYou are receiving this because you are in the ${m.familyName} tree on Family Heritage.` });
          delivery.email = 'sent';
        } else {
          if (!user) {
            delivery.push = 'skipped';
            continue;
          }
          delivery.push = (await this.push.pushTo(user._id, { title: m.pushTitle, body: m.message.slice(0, 180), url: m.url, tag: m.tag })) > 0 ? 'sent' : 'skipped';
        }
      } catch (err) {
        delivery[channel] = 'failed';
        error = `${channel}: ${err instanceof Error ? err.message : 'failed'}`.slice(0, 300);
        this.logger.warn({ err, channel }, 'Announcement delivery failed');
      }
    }
    return { delivery, error };
  }

  /**
   * Hourly (worker): announcements held for the night whose time has come, and the day-before reminders, which
   * go to everyone who has not said they will not come, unless it is night.
   */
  async runDue(now = new Date()): Promise<{ sent: number; reminders: number }> {
    let sent = 0;
    for (const due of await AnnouncementModel.find({ status: 'scheduled', scheduledFor: { $lte: now } }, { _id: 1 }).limit(100).lean()) {
      await this.deliver(due._id.toString());
      sent++;
    }
    let reminders = 0;
    if (this.sendAt(now) > now) return { sent, reminders };
    for (const a of await AnnouncementModel.find({ remind: true, reminderSentAt: null, status: 'sent', remindAt: { $lte: now }, closesAt: { $gt: now } }, { _id: 1 }).limit(100).lean()) {
      const doc = await AnnouncementModel.findOneAndUpdate({ _id: a._id, reminderSentAt: null }, { $set: { reminderSentAt: now } }, { new: true });
      if (!doc) continue;
      await this.remind(doc);
      reminders++;
    }
    return { sent, reminders };
  }

  private async remind(doc: AnnouncementDoc): Promise<void> {
    const event = await FamilyEventModel.findById(doc.eventId, { title: 1, place: 1 }).lean();
    const family = await FamilyModel.findById(doc.familyId, { name: 1, messageTemplate: 1 }).lean();
    const sender: Sender = family ?? { name: 'Your family' };
    const message = doc.reminderMessage || `Reminder: ${event?.title ?? 'the ceremony'} is tomorrow${event?.place ? `, ${event.place}` : ''}.`;
    const people = new Map((await FamilyMemberModel.find({ _id: { $in: doc.recipients.map((r) => r.memberId) } }, { firstName: 1, preferredName: 1, messagingOptOutAt: 1 }).lean()).map((p) => [p._id.toString(), p]));
    const parts = smsParts(this.text(sender, { message, linkLabel: doc.linkLabel, rsvp: doc.rsvp }, this.sampleLink())).parts;
    let sms = 0;
    const reminded: Record<string, Date> = {};
    await this.forEach(
      doc.recipients.map((r, i) => ({ r, i })).filter(({ r }) => r.rsvp !== 'no'),
      async ({ r, i }) => {
        const person = people.get(r.memberId.toString());
        const link = this.link(doc._id, r.memberId);
        const outcome = await this.sendTo(doc.channels as AnnounceChannel[], r, {
          text: this.text(sender, { message, linkLabel: doc.linkLabel, rsvp: doc.rsvp }, link),
          firstName: person?.preferredName || person?.firstName || '',
          link,
          optedOut: !!person?.messagingOptOutAt,
          subject: `${sender.name}: ${event?.title ?? 'a family ceremony'}`,
          pushTitle: `${sender.name}: ${event?.title ?? 'Family reminder'}`,
          message,
          line: this.line(sender, message),
          familyName: sender.name,
          url: `/ceremonies/${doc.eventId.toString()}`,
          tag: `announcement-${doc.id as string}`,
        });
        if (outcome.delivery.sms === 'sent') sms += parts;
        reminded[`recipients.${i}.remindedAt`] = new Date();
      },
    );
    await AnnouncementModel.updateOne({ _id: doc._id }, { $set: reminded, $inc: { smsParts: sms } });
  }

  // ------------------------------------------------------------------ reading

  private async views(access: FamilyAccess, docs: AnnouncementDoc[]): Promise<AnnouncementView[]> {
    const senders = await UserModel.find({ _id: { $in: docs.map((d) => d.createdBy) } }, { displayName: 1 }).lean();
    return docs.map((d) => {
      const count = (c: AnnounceChannel) => d.recipients.filter((r) => r.delivery?.[c] === 'sent').length;
      return {
        id: d.id as string,
        eventId: d.eventId.toString(),
        message: d.message,
        channels: d.channels as AnnounceChannel[],
        audience: d.audience?.label ?? '',
        sentBy: senders.find((u) => u._id.equals(d.createdBy))?.displayName ?? 'Former member',
        createdAt: d.get('createdAt').toISOString(),
        status: d.status,
        scheduledFor: d.status === 'scheduled' ? d.scheduledFor.toISOString() : null,
        counts: { recipients: d.recipients.length, sms: count('sms'), whatsapp: count('whatsapp'), email: count('email'), push: count('push'), failed: d.recipients.filter((r) => Object.values(r.delivery ?? {}).includes('failed')).length },
        rsvp: { enabled: d.rsvp, yes: d.recipients.filter((r) => r.rsvp === 'yes').length, no: d.recipients.filter((r) => r.rsvp === 'no').length, waiting: d.recipients.filter((r) => !r.rsvp).length },
        remind: { enabled: d.remind, sentAt: d.reminderSentAt?.toISOString() ?? null },
      };
    });
  }

  async list(access: FamilyAccess, eventId: Types.ObjectId): Promise<AnnouncementView[]> {
    await this.event(access, eventId);
    return this.views(access, await AnnouncementModel.find({ familyId: access.familyId, eventId }).sort({ createdAt: -1 }).limit(50));
  }

  async recipients(access: FamilyAccess, id: Types.ObjectId): Promise<AnnouncementRecipientView[]> {
    const doc = await AnnouncementModel.findOne({ _id: id, familyId: access.familyId });
    if (!doc) throw AppError.notFound('Announcement');
    await this.event(access, doc.eventId);
    const policy = new MemberPolicy(access);
    const people = new Map((await FamilyMemberModel.find({ _id: { $in: doc.recipients.map((r) => r.memberId) } })).map((p) => [p.id as string, p]));
    return doc.recipients
      .map((r) => {
        const p = people.get(r.memberId.toString());
        return p ? { person: toPersonCard(p, policy), phone: r.phone ? maskPhone(r.phone) : null, delivery: { ...(r.delivery ?? {}) }, rsvp: (r.rsvp as 'yes' | 'no' | null) ?? null, optedOut: !!p.messagingOptOutAt } : null;
      })
      .filter((r): r is AnnouncementRecipientView => !!r && !!r.person)
      .sort((a, b) => a.person.displayName.localeCompare(b.person.displayName));
  }

  // ------------------------------------------------------------------ the personal link (public)

  private async byToken(token: string): Promise<{ doc: AnnouncementDoc; index: number }> {
    const hash = sha256(token);
    const doc = await AnnouncementModel.findOne({ 'recipients.tokenHash': hash });
    const index = doc?.recipients.findIndex((r) => r.tokenHash === hash) ?? -1;
    if (!doc || index < 0) throw AppError.notFound('Link');
    return { doc, index };
  }

  async rsvpView(token: string): Promise<RsvpView> {
    const { doc, index } = await this.byToken(token);
    const r = doc.recipients[index]!;
    const [event, family, person] = await Promise.all([
      FamilyEventModel.findById(doc.eventId, { title: 1, date: 1, place: 1, deletedAt: 1 }).lean(),
      FamilyModel.findById(doc.familyId, { name: 1 }).lean(),
      FamilyMemberModel.findById(r.memberId, { firstName: 1, preferredName: 1, messagingOptOutAt: 1 }).lean(),
    ]);
    if (!event || event.deletedAt || !family) throw AppError.notFound('Link');
    return {
      familyName: family.name,
      firstName: person?.preferredName || person?.firstName || '',
      title: event.title,
      date: event.date ? formatFuzzyDate(event.date as never) : '',
      place: event.place ?? '',
      message: doc.message,
      answer: doc.rsvp ? ((r.rsvp as 'yes' | 'no' | null) ?? null) : null,
      optedOut: !!person?.messagingOptOutAt,
      closed: !doc.rsvp || (!!doc.closesAt && doc.closesAt < new Date()),
    };
  }

  async rsvpAnswer(token: string, answer: RsvpAnswer): Promise<RsvpView> {
    const { doc, index } = await this.byToken(token);
    const r = doc.recipients[index]!;
    if (answer === 'stop' || answer === 'start') {
      // Stopping is kept on the person, so it holds for every later announcement until they turn messages back on.
      const stop = answer === 'stop';
      const res = await FamilyMemberModel.updateOne({ _id: r.memberId, messagingOptOutAt: stop ? null : { $ne: null } }, { $set: { messagingOptOutAt: stop ? new Date() : null } });
      if (res.modifiedCount) await this.audit.record({ familyId: doc.familyId, actorId: null, actorRole: 'system', action: stop ? 'member.messaging_opt_out' : 'member.messaging_opt_in', targetType: 'member', targetId: r.memberId, after: { through: 'personal link' } });
    } else {
      if (!doc.rsvp || (doc.closesAt && doc.closesAt < new Date())) throw new AppError('CONFLICT', 'Answers for this ceremony are closed.');
      await AnnouncementModel.updateOne({ _id: doc._id }, { $set: { [`recipients.${index}.rsvp`]: answer, [`recipients.${index}.rsvpAt`]: new Date() } });
    }
    return this.rsvpView(token);
  }
}

