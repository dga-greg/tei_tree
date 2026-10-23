import { Types } from 'mongoose';
import { z } from 'zod';
import {
  CALENDAR_KINDS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type CalendarItem,
  type CalendarKind,
  type DigestPreview,
  type NotificationPreferences,
  type PushStatus,
} from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { EmailDispatcher } from '../../infra/queues.js';
import type { PushMessage, PushSender } from '../../infra/push.js';
import { archiveVisibility } from '../archive/archive.shared.js';
import type { CalendarService } from '../calendar/calendar.service.js';
import { resolveFamilyAccess, type FamilyAccess } from '../families/family-access.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { FamilyMediaModel } from '../media/media.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { FamilyStoryModel } from '../stories/story.model.js';
import { UserModel } from '../users/user.model.js';
import { NotificationDeliveryModel, PushSubscriptionModel } from './notifications.model.js';

/** Push services browsers use. Subscriptions elsewhere are refused, so the server never posts to arbitrary hosts. */
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.microsoft\.com$/];
const MAX_DEVICES = 10;

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const preferencesBody = z
  .object({
    weeklyDigest: z.boolean(),
    push: z.boolean(),
    kinds: z.object(Object.fromEntries(CALENDAR_KINDS.map((k) => [k, z.boolean()])) as Record<CalendarKind, z.ZodBoolean>).strict(),
    timezone: z.string().max(64).refine(validTimezone, 'Unknown time zone'),
  })
  .strict();

export const subscriptionBody = z
  .object({
    endpoint: z
      .url()
      .max(2000)
      .refine((u) => {
        const url = new URL(u);
        return url.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(url.hostname));
      }, 'Not a supported push service'),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }).strict(),
  })
  .strict();
export const unsubscribeBody = z.object({ endpoint: z.string().max(2000) }).strict();

/** Local calendar date, weekday and hour in a time zone. */
export function localTime(now: Date, timezone: string): { date: string; hour: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts['weekday']!) + 1;
  return { date: `${parts['year']}-${parts['month']}-${parts['day']}`, hour: Number(parts['hour']), weekday };
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO week of a calendar day, e.g. "2026-W43". */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function prefsOf(user: { notifications?: unknown }): NotificationPreferences {
  const n = (user.notifications ?? {}) as Partial<NotificationPreferences>;
  return {
    weeklyDigest: n.weeklyDigest ?? DEFAULT_NOTIFICATION_PREFERENCES.weeklyDigest,
    push: n.push ?? DEFAULT_NOTIFICATION_PREFERENCES.push,
    kinds: { ...DEFAULT_NOTIFICATION_PREFERENCES.kinds, ...(n.kinds ?? {}) },
    timezone: n.timezone ?? DEFAULT_NOTIFICATION_PREFERENCES.timezone,
  };
}

interface FamilyWeek {
  name: string;
  items: CalendarItem[];
  added: { people: number; files: number; stories: number };
}

export interface ReminderRunResult {
  digests: number;
  pushes: number;
}

/**
 * Reminders: notification preferences, devices for phone notifications, the weekly e-mail and the
 * morning notification. `run` is called every hour (worker schedule, or a timer without Redis) and sends
 * what is due in each person's own time zone; delivery records make repeated runs harmless.
 */
export class NotificationsService {
  constructor(
    private readonly calendar: CalendarService,
    private readonly email: EmailDispatcher,
    private readonly push: PushSender,
    private readonly appOrigin: string,
    private readonly logger: Logger,
    private readonly reminderHour = 7,
  ) {}

  // ------------------------------------------------------------------ preferences and devices

  async preferences(userId: Types.ObjectId): Promise<NotificationPreferences> {
    const user = await UserModel.findById(userId, { notifications: 1 }).lean();
    if (!user) throw AppError.notFound('Account');
    return prefsOf(user);
  }

  async setPreferences(userId: Types.ObjectId, prefs: z.output<typeof preferencesBody>): Promise<NotificationPreferences> {
    await UserModel.updateOne({ _id: userId }, { $set: { notifications: prefs } });
    return this.preferences(userId);
  }

  async pushStatus(userId: Types.ObjectId): Promise<PushStatus> {
    return { publicKey: this.push.publicKey, devices: this.push.publicKey ? await PushSubscriptionModel.countDocuments({ userId }) : 0 };
  }

  async subscribe(userId: Types.ObjectId, body: z.output<typeof subscriptionBody>, userAgent: string): Promise<PushStatus> {
    if (!this.push.publicKey) throw new AppError('CONFLICT', 'Notifications are not set up on this server');
    // A device that changes hands moves to the account now signed in on it.
    await PushSubscriptionModel.updateOne(
      { endpoint: body.endpoint },
      { $set: { userId, keys: body.keys, userAgent: userAgent.slice(0, 300) } },
      { upsert: true },
    );
    const extra = await PushSubscriptionModel.find({ userId }).sort({ updatedAt: -1 }).skip(MAX_DEVICES).select({ _id: 1 }).lean();
    if (extra.length) await PushSubscriptionModel.deleteMany({ _id: { $in: extra.map((e) => e._id) } });
    await UserModel.updateOne({ _id: userId }, { $set: { 'notifications.push': true } });
    await this.ensurePrefs(userId);
    return this.pushStatus(userId);
  }

  async unsubscribe(userId: Types.ObjectId, endpoint: string): Promise<PushStatus> {
    await PushSubscriptionModel.deleteOne({ userId, endpoint });
    return this.pushStatus(userId);
  }

  /** Sends a test notification to every device of the account. */
  async test(userId: Types.ObjectId): Promise<{ sent: number }> {
    const sent = await this.sendPush(userId, { title: 'Family Heritage', body: 'Notifications are working on this device.', url: '/calendar', tag: 'test' });
    if (!sent) throw new AppError('CONFLICT', 'No device received the notification. Turn notifications on again on this device.');
    return { sent };
  }

  /** The stored preferences document must exist before dotted updates fill its defaults. */
  private async ensurePrefs(userId: Types.ObjectId): Promise<void> {
    const user = await UserModel.findById(userId, { notifications: 1 }).lean();
    if (user) await UserModel.updateOne({ _id: userId }, { $set: { notifications: prefsOf(user) } });
  }

  /** A notification on the person's devices (family announcements); the number of devices reached. */
  pushTo(userId: Types.ObjectId, message: PushMessage): Promise<number> {
    return this.sendPush(userId, message);
  }

  private async sendPush(userId: Types.ObjectId, message: PushMessage): Promise<number> {
    const subs = await PushSubscriptionModel.find({ userId });
    let sent = 0;
    for (const s of subs) {
      const result = await this.push.send({ endpoint: s.endpoint, keys: { p256dh: s.keys!.p256dh, auth: s.keys!.auth } }, message);
      if (result.gone) await PushSubscriptionModel.deleteOne({ _id: s._id });
      if (result.ok) {
        sent++;
        await PushSubscriptionModel.updateOne({ _id: s._id }, { $set: { lastSentAt: new Date() } });
      }
    }
    return sent;
  }

  // ------------------------------------------------------------------ content

  private async familiesOf(userId: Types.ObjectId): Promise<FamilyAccess[]> {
    const memberships = await FamilyMembershipModel.find({ userId, status: 'active' }, { familyId: 1 }).lean();
    const out: FamilyAccess[] = [];
    for (const m of memberships) {
      const access = await resolveFamilyAccess(m.familyId, userId);
      if (access?.membership && access.family.status === 'active') out.push(access);
    }
    return out;
  }

  private kinds(prefs: NotificationPreferences): Set<CalendarKind> {
    return new Set(CALENDAR_KINDS.filter((k) => prefs.kinds[k]));
  }

  private async week(userId: Types.ObjectId, prefs: NotificationPreferences, today: string, now: Date): Promise<FamilyWeek[]> {
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const out: FamilyWeek[] = [];
    for (const access of await this.familiesOf(userId)) {
      const items = await this.calendar.items(access, today, addDays(today, 6), this.kinds(prefs));
      const [people, files, stories] = await Promise.all([
        FamilyMemberModel.countDocuments({ familyId: access.familyId, deletedAt: null, createdAt: { $gte: weekAgo } }),
        FamilyMediaModel.countDocuments({ ...(await archiveVisibility(access, 'uploadedBy')), status: 'published', createdAt: { $gte: weekAgo } }),
        FamilyStoryModel.countDocuments({ ...(await archiveVisibility(access, 'createdBy')), status: 'published', createdAt: { $gte: weekAgo } }),
      ]);
      out.push({ name: access.family.name, items, added: { people, files, stories } });
    }
    return out;
  }

  private digestText(displayName: string, weeks: FamilyWeek[]): DigestPreview {
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const sections = weeks
      .filter((w) => w.items.length || w.added.people || w.added.files || w.added.stories)
      .map((w) => {
        const lines = [w.name, '-'.repeat(w.name.length)];
        if (w.items.length) {
          lines.push('The week ahead:');
          for (const i of w.items.slice(0, 30)) lines.push(`  • ${shortDay(i.date)}: ${i.title}`);
          if (w.items.length > 30) lines.push(`  …and ${w.items.length - 30} more in the calendar.`);
        }
        const added = [
          w.added.people && plural(w.added.people, 'person', 'people'),
          w.added.files && plural(w.added.files, 'photo or document', 'photos and documents'),
          w.added.stories && plural(w.added.stories, 'story', 'stories'),
        ].filter(Boolean);
        if (added.length) lines.push(`Added last week: ${added.join(', ')}.`);
        return lines.join('\n');
      });
    const families = weeks.filter((w) => w.items.length || w.added.people || w.added.files || w.added.stories);
    const subject = families.length === 1 ? `This week in the ${families[0]!.name}` : 'This week in your families';
    const text = [
      `Hello ${displayName},`,
      '',
      ...sections.flatMap((s) => [s, '']),
      `Open the family calendar: ${this.appOrigin}/calendar`,
      '',
      `You receive this e-mail once a week. To change it, go to ${this.appOrigin}/settings (Notifications).`,
    ].join('\n');
    return { subject, text, hasContent: sections.length > 0 };
  }

  async digestPreview(userId: Types.ObjectId, now = new Date()): Promise<DigestPreview> {
    const user = await UserModel.findById(userId, { displayName: 1, notifications: 1 }).lean();
    if (!user) throw AppError.notFound('Account');
    const prefs = prefsOf(user);
    return this.digestText(user.displayName, await this.week(userId, prefs, localTime(now, prefs.timezone).date, now));
  }

  private todayMessage(items: { family: string; item: CalendarItem }[]): PushMessage {
    const families = [...new Set(items.map((i) => i.family))];
    const first = items[0]!.item.title;
    return {
      title: families.length === 1 ? `Today in the ${families[0]}` : 'Today in your families',
      body: items.length === 1 ? first : `${first}, and ${items.length - 1} more`,
      url: '/calendar',
      tag: 'today',
    };
  }

  // ------------------------------------------------------------------ the hourly run

  /** Claims a delivery; false when it was already made (by this run or another worker). */
  private async claim(userId: Types.ObjectId, kind: 'digest' | 'push', key: string): Promise<boolean> {
    try {
      await NotificationDeliveryModel.create({ userId, kind, key });
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    }
  }

  async run(now = new Date()): Promise<ReminderRunResult> {
    const result: ReminderRunResult = { digests: 0, pushes: 0 };
    const cursor = UserModel.find({ status: 'active', emailVerifiedAt: { $ne: null } }, { email: 1, displayName: 1, notifications: 1 }).lean().cursor();
    for await (const user of cursor) {
      try {
        const prefs = prefsOf(user);
        const local = localTime(now, prefs.timezone);
        if (local.hour < this.reminderHour) continue;
        const wantsPush = prefs.push && !!this.push.publicKey;
        if (!prefs.weeklyDigest && !wantsPush) continue;
        if (!(await FamilyMembershipModel.exists({ userId: user._id, status: 'active' }))) continue;

        if (prefs.weeklyDigest && (await this.claim(user._id, 'digest', isoWeek(local.date)))) {
          const digest = this.digestText(user.displayName, await this.week(user._id, prefs, local.date, now));
          if (digest.hasContent) {
            this.email.dispatch({ to: user.email, subject: digest.subject, text: digest.text });
            await NotificationDeliveryModel.updateOne({ userId: user._id, kind: 'digest', key: isoWeek(local.date) }, { $set: { sent: true } });
            result.digests++;
          }
        }
        if (wantsPush && (await PushSubscriptionModel.exists({ userId: user._id })) && (await this.claim(user._id, 'push', local.date))) {
          const today: { family: string; item: CalendarItem }[] = [];
          for (const access of await this.familiesOf(user._id)) {
            for (const item of await this.calendar.items(access, local.date, local.date, this.kinds(prefs))) today.push({ family: access.family.name, item });
          }
          if (today.length && (await this.sendPush(user._id, this.todayMessage(today)))) {
            await NotificationDeliveryModel.updateOne({ userId: user._id, kind: 'push', key: local.date }, { $set: { sent: true } });
            result.pushes++;
          }
        }
      } catch (err) {
        // One person's problem must not stop everyone else's reminders.
        this.logger.error({ err, userId: user._id }, 'Reminder failed');
      }
    }
    return result;
  }
}
