import type { Env } from '../config/env.js';
import type { Logger } from '../core/logger.js';

/** One message to one phone. */
export interface SendResult {
  ok: boolean;
  /** The provider's message id, when it gives one. */
  id?: string;
  error?: string;
}

export interface SmsSender {
  readonly name: string;
  send(to: string, text: string): Promise<SendResult>;
}

/** WhatsApp messages started by the family must use a template approved by Meta; the variable parts fill it. */
export interface WhatsAppMessage {
  firstName: string;
  text: string;
  link: string;
}

export interface WhatsAppSender {
  readonly name: string;
  send(to: string, message: WhatsAppMessage): Promise<SendResult>;
}

type Fetch = typeof fetch;
const TIMEOUT_MS = 15_000;

/**
 * A phone number as providers want it: country code and number, digits only ("233244123456"). Local Ghanaian
 * numbers ("024 412 3456") get the 233 prefix. Null when it cannot be a phone number.
 */
export function normalisePhone(raw: string | null | undefined, countryCode = '233'): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = countryCode + digits.slice(1);
  else if (digits.length === 9) digits = countryCode + digits;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** "…456": enough for an organiser to recognise a number without showing it. */
export function maskPhone(phone: string): string {
  return `…${phone.slice(-3)}`;
}

/** SMS parts a message takes: 160 characters for plain text, 70 when it needs Unicode (e.g. ɛ, ɔ). */
export function smsParts(text: string): { parts: number; partLength: number } {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅå_ÆæßÉÄÖÑÜ§¿äöñüà€]*$/.test(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const parts = text.length <= single ? 1 : Math.ceil(text.length / multi);
  return { parts, partLength: single };
}

/** GiantSMS (giantsms.com), a Ghanaian SMS provider: one message per request, authorised with the account's API token. */
export class GiantSmsSender implements SmsSender {
  readonly name = 'giantsms';
  constructor(
    private readonly token: string,
    private readonly senderId: string,
    private readonly fetcher: Fetch = fetch,
    private readonly base = 'https://api.giantsms.com/api/v1',
  ) {}

  async send(to: string, text: string): Promise<SendResult> {
    try {
      const res = await this.fetcher(`${this.base}/send`, {
        method: 'POST',
        headers: { Authorization: `Basic ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ from: this.senderId, to, msg: text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: { message_id?: string } };
      if (res.ok && body.status === true) return { ok: true, id: body.data?.message_id };
      return { ok: false, error: body.message || `GiantSMS answered ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'GiantSMS could not be reached' };
    }
  }
}

/** WhatsApp Business through Meta's Cloud API, with a template whose body takes {{1}} name, {{2}} message, {{3}} link. */
export class CloudWhatsAppSender implements WhatsAppSender {
  readonly name = 'whatsapp-cloud';
  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly template: string,
    private readonly language: string,
    private readonly fetcher: Fetch = fetch,
    private readonly base = 'https://graph.facebook.com/v21.0',
  ) {}

  async send(to: string, message: WhatsAppMessage): Promise<SendResult> {
    // Template values may not contain line breaks, tabs or long runs of spaces.
    const clean = (s: string, max: number) => s.replace(/\s*\n+\s*/g, ' · ').replace(/[\t ]{2,}/g, ' ').trim().slice(0, max);
    try {
      const res = await this.fetcher(`${this.base}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: this.template,
            language: { code: this.language },
            components: [{ type: 'body', parameters: [clean(message.firstName, 60), clean(message.text, 900), clean(message.link, 300)].map((text) => ({ type: 'text', text })) }],
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
      if (res.ok && body.messages?.[0]?.id) return { ok: true, id: body.messages[0].id };
      return { ok: false, error: body.error?.message || `WhatsApp answered ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'WhatsApp could not be reached' };
    }
  }
}

/** Development and tests: messages are written to the log (and kept in `outbox`) instead of being sent. */
export class LogSmsSender implements SmsSender, WhatsAppSender {
  readonly outbox: { channel: 'sms' | 'whatsapp'; to: string; text: string }[] = [];
  constructor(
    readonly name: string,
    private readonly logger: Logger,
    private readonly channel: 'sms' | 'whatsapp' = 'sms',
  ) {}

  async send(to: string, message: string | WhatsAppMessage): Promise<SendResult> {
    const text = typeof message === 'string' ? message : `${message.firstName}: ${message.text} ${message.link}`;
    this.outbox.push({ channel: this.channel, to, text });
    this.logger.info({ channel: this.channel, to, text }, `${this.channel === 'sms' ? 'SMS' : 'WhatsApp'} message (not sent: logged only)`);
    return { ok: true, id: `log-${this.outbox.length}` };
  }
}

/**
 * The family messaging channels this server can use. SMS goes through GiantSMS when its token is set
 * (or SMS_PROVIDER=log writes messages to the log instead); WhatsApp needs a Meta Cloud API number.
 */
export function messagingFromEnv(env: Env, logger: Logger): { sms: SmsSender | null; whatsapp: WhatsAppSender | null } {
  const provider = env.SMS_PROVIDER ?? (env.GIANT_AUTH && env.GIANT_SENDER_ID ? 'giantsms' : 'none');
  if (provider === 'log') return { sms: new LogSmsSender('log', logger, 'sms'), whatsapp: new LogSmsSender('log', logger, 'whatsapp') };
  const sms = provider === 'giantsms' ? new GiantSmsSender(env.GIANT_AUTH!, env.GIANT_SENDER_ID!) : null;
  const whatsapp = env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? new CloudWhatsAppSender(env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID, env.WHATSAPP_TEMPLATE, env.WHATSAPP_TEMPLATE_LANGUAGE) : null;
  return { sms, whatsapp };
}
