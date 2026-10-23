import type { Env } from '../../config/env.js';
import type { Logger } from '../../core/logger.js';
import { LogMailer, SmtpMailer } from '../../infra/mailer.js';
import { pushSenderFromEnv } from '../../infra/push.js';
import { EmailDispatcher } from '../../infra/queues.js';
import type { Redis } from '../../infra/redis.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { NotificationsService } from './notifications.service.js';

/** Reminders outside the API (worker, command line). E-mail goes through the queue when Redis is given. */
export function notificationsFromEnv(env: Env, logger: Logger, redis?: Redis): { notifications: NotificationsService; email: EmailDispatcher } {
  const mailer = env.SMTP_URL ? new SmtpMailer(env.SMTP_URL, env.MAIL_FROM) : new LogMailer(logger);
  const email = new EmailDispatcher(mailer, logger, redis);
  return { notifications: new NotificationsService(new CalendarService(), email, pushSenderFromEnv(env, logger), env.APP_ORIGIN, logger, env.REMINDER_HOUR), email };
}
