import { Queue } from 'bullmq';
import type { Redis } from './redis.js';
import type { Logger } from '../core/logger.js';
import type { Mailer, MailMessage } from './mailer.js';

export const QUEUE_NAMES = {
  email: 'email',
  generations: 'generations',
  maintenance: 'maintenance',
  transcriptions: 'transcriptions',
  books: 'books',
  announcements: 'announcements',
} as const;

export interface EmailJob {
  message: MailMessage;
}

/**
 * Sends e-mail through the background queue when Redis is configured (production), or directly
 * otherwise. Dispatch never blocks the HTTP response on SMTP and never throws into the caller —
 * a failed e-mail must not turn into an observable difference (e.g. account enumeration).
 */
export class EmailDispatcher {
  private readonly queue: Queue<EmailJob> | null;

  constructor(
    private readonly mailer: Mailer,
    private readonly logger: Logger,
    redis?: Redis,
  ) {
    this.queue = redis ? new Queue<EmailJob>(QUEUE_NAMES.email, { connection: redis }) : null;
  }

  dispatch(message: MailMessage): void {
    const task = this.queue
      ? this.queue.add('send', { message }, { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 5000 })
      : this.mailer.send(message);
    Promise.resolve(task).catch((err: unknown) => this.logger.error({ err, to: message.to }, 'Failed to dispatch e-mail'));
  }

  async close(): Promise<void> {
    await this.queue?.close();
  }
}
