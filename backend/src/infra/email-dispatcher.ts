import type { Logger } from '../core/logger.js';
import type { Mailer, MailMessage } from './mailer.js';

/**
 * Sends e-mail straight from the API process, in the background. Dispatch never blocks the HTTP response on SMTP
 * and never throws into the caller — a failed e-mail must not turn into an observable difference (e.g. account
 * enumeration). A failed send is retried a few times before it is logged and given up.
 */
export class EmailDispatcher {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly mailer: Mailer,
    private readonly logger: Logger,
    private readonly retryDelaysMs: readonly number[] = [10_000, 60_000],
  ) {}

  dispatch(message: MailMessage): void {
    const task = this.send(message).finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  private async send(message: MailMessage): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.mailer.send(message);
        return;
      } catch (err) {
        const delay = this.retryDelaysMs[attempt];
        if (delay === undefined) {
          this.logger.error({ err, to: message.to }, 'Failed to send e-mail');
          return;
        }
        await new Promise((r) => setTimeout(r, delay).unref());
      }
    }
  }

  /** Waits (up to `timeoutMs`) for e-mails still being sent, on shutdown. */
  async close(timeoutMs = 10_000): Promise<void> {
    await Promise.race([Promise.allSettled([...this.pending]), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }
}
