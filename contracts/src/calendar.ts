import type { PersonCard } from './members.js';

// ------------------------------------------------------------------ family calendar

/**
 * What a calendar day can hold:
 * - `birthday`: a living person's birthday (people whose exact birth date the viewer may see);
 * - `remembrance`: the anniversary of a death;
 * - `birth_remembrance`: the birthday of someone who has died ("would have turned …");
 * - `anniversary`: a wedding anniversary of a couple still together (or widowed);
 * - `event`: a family event recorded with an exact date.
 */
export const CALENDAR_KINDS = ['birthday', 'remembrance', 'birth_remembrance', 'anniversary', 'event'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  birthday: 'Birthdays',
  remembrance: 'Remembrance days',
  birth_remembrance: 'Birthdays of those who have passed',
  anniversary: 'Wedding anniversaries',
  event: 'Family events',
};

export interface CalendarItem {
  /** Calendar day, YYYY-MM-DD. */
  date: string;
  kind: CalendarKind;
  /** Ready to show, e.g. "Ama Mensah's 80th birthday". */
  title: string;
  people: PersonCard[];
  /** Age reached, or years since the death, wedding or event; null when the year is not known. */
  years: number | null;
  eventId?: string;
  place?: string;
}

export interface CalendarQuery {
  /** First day, YYYY-MM-DD. */
  from: string;
  /** Last day, YYYY-MM-DD (at most 366 days after `from`). */
  to: string;
}

// ------------------------------------------------------------------ notifications

export interface NotificationPreferences {
  /** A weekly e-mail: the week ahead in each family, and what was added last week. */
  weeklyDigest: boolean;
  /** Notifications on devices where the person turned them on: what happens today. */
  push: boolean;
  /** Which calendar days to be reminded of. */
  kinds: Record<CalendarKind, boolean>;
  /** IANA time zone, so reminders arrive in the morning where the person lives. */
  timezone: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  weeklyDigest: true,
  push: false,
  kinds: { birthday: true, remembrance: true, birth_remembrance: false, anniversary: true, event: true },
  timezone: 'UTC',
};

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushStatus {
  /** VAPID public key; null when the server is not set up to send notifications. */
  publicKey: string | null;
  /** Devices this account receives notifications on. */
  devices: number;
}

/** What the next weekly e-mail would say (shown in settings). */
export interface DigestPreview {
  subject: string;
  text: string;
  /** False when there is nothing to tell this week, so no e-mail would be sent. */
  hasContent: boolean;
}
