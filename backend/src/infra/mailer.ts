import nodemailer from 'nodemailer';
import type { Logger } from '../core/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Delivers a message. Implementations must not throw for recipient-level problems silently. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

/**
 * Development-only mailer that writes messages to the log so links (e.g. password reset) can be
 * followed without an SMTP server. Never used when NODE_ENV=production (SMTP_URL is required there).
 */
export class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.info({ mail: { to: message.to, subject: message.subject, text: message.text } }, 'E-mail (not sent: no SMTP_URL configured)');
  }
}

/** Collects messages in memory. Used by automated tests. */
export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
  }
}
