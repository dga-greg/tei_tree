import type { PersonCard } from './members.js';

/**
 * Announcing a ceremony to relatives: by SMS and WhatsApp (also reaching people who never sign in), and by e-mail
 * and app notification to those with an account. Each person gets a link to say whether they are coming.
 */
export const ANNOUNCE_CHANNELS = ['sms', 'whatsapp', 'email', 'push'] as const;
export type AnnounceChannel = (typeof ANNOUNCE_CHANNELS)[number];

export const ANNOUNCE_CHANNEL_LABELS: Record<AnnounceChannel, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  push: 'App notification',
};

export type AnnouncementAudience = { kind: 'all' } | { kind: 'branch'; branchId: string } | { kind: 'people'; memberIds: string[] };

export interface AnnouncementRequest {
  audience: AnnouncementAudience;
  channels: AnnounceChannel[];
  message: string;
  /** Add a personal link to say "Attending" or "Can't make it". */
  rsvp: boolean;
  /** Remind those who have not declined, the day before (dated ceremonies only). */
  remind: boolean;
}

/** What the family's messaging can do, for the announce form. */
export interface MessagingStatus {
  sms: boolean;
  whatsapp: boolean;
  /** Estimated price of one SMS part, in pesewas (for the estimate shown before sending). */
  smsPricePesewas: number;
  /** SMS parts the family may still send this month. */
  smsLeftThisMonth: number;
  /** Characters in one SMS part. */
  smsPartLength: number;
}

/**
 * How the family's announcements begin and end, so people know which family a message is from: all families send
 * through the same SMS sender ID and e-mail address. `{family}` stands for the family's name.
 */
export interface FamilyMessageTemplate {
  /** The first line, e.g. "{family} announcement:". */
  opening: string;
  /** An optional last line before the link, e.g. "Abusua Panin, Kofi Mensah". */
  signOff: string;
}

export const DEFAULT_MESSAGE_TEMPLATE: FamilyMessageTemplate = { opening: '{family} announcement:', signOff: '' };
export const MESSAGE_OPENING_MAX_LENGTH = 80;
export const MESSAGE_SIGN_OFF_MAX_LENGTH = 80;

/** The template's line with the family's name put in. */
export function fillTemplateLine(line: string, familyName: string): string {
  return line.replace(/\{family\}/g, familyName).trim();
}

/** An announcement as SMS and e-mail carry it: opening, message, sign-off, then the link on its own line. */
export function composeAnnouncement(input: { template: FamilyMessageTemplate; familyName: string; message: string; linkLine: string }): string {
  const opening = fillTemplateLine(input.template.opening, input.familyName);
  const signOff = fillTemplateLine(input.template.signOff, input.familyName);
  return [opening, input.message.trim(), signOff, input.linkLine].filter(Boolean).join('\n');
}

/** WhatsApp templates take one line of text: opening, message and sign-off joined with spaces. */
export function composeAnnouncementLine(input: { template: FamilyMessageTemplate; familyName: string; message: string }): string {
  const parts = [fillTemplateLine(input.template.opening, input.familyName), input.message.trim(), fillTemplateLine(input.template.signOff, input.familyName)];
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

/** Who an announcement would reach, before it is sent. */
export interface AnnouncementPreview {
  recipients: number;
  bySms: number;
  byWhatsapp: number;
  byEmail: number;
  byPush: number;
  /** People the chosen channels cannot reach (no phone number and no account), to call instead. */
  unreachable: PersonCard[];
  /** People who asked not to get SMS or WhatsApp messages. */
  optedOut: number;
  /** SMS parts per message (with the attendance link). */
  smsParts: number;
  smsCostPesewas: number;
  /** The SMS and e-mail text as it will be sent, with the family's opening and sign-off (a sample link). */
  text: string;
  /** Sent at 7:00 instead, because it is night in Ghana. */
  heldUntil: string | null;
}

export type AnnouncementStatus = 'scheduled' | 'sending' | 'sent';
export type DeliveryState = 'sent' | 'failed' | 'skipped';

export interface AnnouncementView {
  id: string;
  eventId: string;
  message: string;
  channels: AnnounceChannel[];
  audience: string;
  sentBy: string;
  createdAt: string;
  status: AnnouncementStatus;
  scheduledFor: string | null;
  counts: { recipients: number; sms: number; whatsapp: number; email: number; push: number; failed: number };
  rsvp: { enabled: boolean; yes: number; no: number; waiting: number };
  remind: { enabled: boolean; sentAt: string | null };
}

export interface AnnouncementRecipientView {
  person: PersonCard;
  /** Last digits only. */
  phone: string | null;
  delivery: Partial<Record<AnnounceChannel, DeliveryState>>;
  rsvp: 'yes' | 'no' | null;
  optedOut: boolean;
}

/** The public page behind a personal link (no sign-in). */
export interface RsvpView {
  familyName: string;
  firstName: string;
  title: string;
  date: string;
  place: string;
  message: string;
  answer: 'yes' | 'no' | null;
  optedOut: boolean;
  /** The ceremony is over: answers are closed. */
  closed: boolean;
}

/** `stop` / `start`: no more SMS or WhatsApp from the family, or messages again. */
export type RsvpAnswer = 'yes' | 'no' | 'stop' | 'start';
