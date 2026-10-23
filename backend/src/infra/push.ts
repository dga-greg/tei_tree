import type { Agent } from 'node:https';
import webpush from 'web-push';
import type { Logger } from '../core/logger.js';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Page opened when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag?: string;
}

/** Result of one delivery: `gone` means the device unsubscribed and the subscription should be deleted. */
export interface PushResult {
  ok: boolean;
  gone: boolean;
}

export interface PushSender {
  readonly publicKey: string | null;
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

/**
 * The payload shape Angular's service worker turns into a notification (and opens `url` when it is tapped).
 */
export function angularPayload(message: PushMessage): string {
  return JSON.stringify({
    notification: {
      title: message.title,
      body: message.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: message.tag,
      data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: message.url } } },
    },
  });
}

export class WebPushSender implements PushSender {
  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
    private readonly logger: Logger,
    /** Connection settings for reaching push services (tests use one that trusts a local server). */
    private readonly agent?: Agent,
  ) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    try {
      await webpush.sendNotification(target, angularPayload(message), {
        vapidDetails: { subject: this.subject, publicKey: this.publicKey, privateKey: this.privateKey },
        TTL: 12 * 3600,
        urgency: 'normal',
        ...(this.agent ? { agent: this.agent } : {}),
      });
      return { ok: true, gone: false };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return { ok: false, gone: true };
      this.logger.warn({ status, host: safeHost(target.endpoint) }, 'Push notification failed');
      return { ok: false, gone: false };
    }
  }
}

/** When no keys are configured: nothing is sent and the app does not offer notifications. */
export class DisabledPushSender implements PushSender {
  readonly publicKey = null;
  async send(): Promise<PushResult> {
    return { ok: false, gone: false };
  }
}

/** Records messages instead of sending them (tests). */
export class MemoryPushSender implements PushSender {
  readonly publicKey = 'BTestPublicKeyForTestsOnly';
  readonly sent: { endpoint: string; message: PushMessage }[] = [];
  gone = new Set<string>();
  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    if (this.gone.has(target.endpoint)) return { ok: false, gone: true };
    this.sent.push({ endpoint: target.endpoint, message });
    return { ok: true, gone: false };
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

export function pushSenderFromEnv(env: { WEB_PUSH_PUBLIC_KEY?: string; WEB_PUSH_PRIVATE_KEY?: string; WEB_PUSH_SUBJECT?: string; MAIL_FROM: string }, logger: Logger): PushSender {
  if (!env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY) return new DisabledPushSender();
  const address = /<([^>]+)>/.exec(env.MAIL_FROM)?.[1] ?? env.MAIL_FROM;
  return new WebPushSender(env.WEB_PUSH_PUBLIC_KEY, env.WEB_PUSH_PRIVATE_KEY, env.WEB_PUSH_SUBJECT ?? `mailto:${address}`, logger);
}
