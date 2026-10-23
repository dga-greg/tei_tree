import { Queue, Worker } from 'bullmq';
import { loadEnv } from './config/env.js';
import { createLogger } from './core/logger.js';
import { connectMongo, disconnectMongo } from './infra/mongo.js';
import { createRedis } from './infra/redis.js';
import { LogMailer, SmtpMailer } from './infra/mailer.js';
import { QUEUE_NAMES, type EmailJob } from './infra/queues.js';
import { Types } from 'mongoose';
import { GenerationsService } from './modules/generations/generations.service.js';
import type { GenerationJob } from './modules/generations/generation-scheduler.js';
import './modules/models.js';
import { storageFromEnv } from './infra/storage.js';
import { AuditService } from './modules/audit/audit.service.js';
import { PasswordHasher } from './modules/auth/password.js';
import { LifecycleService } from './modules/lifecycle/lifecycle.service.js';
import { notificationsFromEnv } from './modules/notifications/notifications.factory.js';
import { transcriberFromEnv } from './infra/transcriber.js';
import { TranscriptionService, type TranscriptionJob } from './modules/media/transcription.service.js';
import { BookService } from './modules/book/book.service.js';
import { AnnouncementsService } from './modules/announcements/announcements.service.js';
import { BranchesService } from './modules/branches/branches.service.js';
import { GenerationScheduler } from './modules/generations/generation-scheduler.js';
import { messagingFromEnv } from './infra/messaging.js';

/** How often expired families and removed files are erased. */
const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;
/** Reminders run every hour; each person gets what is due in their own time zone. */
const REMINDERS_EVERY_MS = 60 * 60 * 1000;

/**
 * Keeps idle workers quiet on Redis. By default each worker asks Redis for work every 5 seconds and checks for
 * stalled jobs every 30: together about 870,000 commands a day with nothing to do (measured), which uses up a hosted
 * Redis plan (Upstash's free tier) within a day. A new job still wakes a waiting worker at once (BullMQ signals it), so
 * waiting longer between checks does not delay anything; a job left behind by a crashed worker is retried within
 * half an hour.
 */
const QUIET = { drainDelay: 600, stalledInterval: 30 * 60 * 1000 };

/**
 * Background worker: outgoing e-mail, generation recalculation for large families, announcements, transcripts and
 * family books (BullMQ queues in Redis), and, on timers, the periodic purge of families past their deletion grace
 * period and of removed files, and hourly reminders.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
  if (!env.REDIS_URL) throw new Error('The worker requires REDIS_URL');

  await connectMongo(env.MONGODB_URI, logger);
  const connection = createRedis(env.REDIS_URL, logger, env.REDIS_TLS_VERIFY);
  const mailer = env.SMTP_URL ? new SmtpMailer(env.SMTP_URL, env.MAIL_FROM) : new LogMailer(logger);

  const emailWorker = new Worker<EmailJob>(
    QUEUE_NAMES.email,
    async (job) => {
      await mailer.send(job.data.message);
    },
    { connection, concurrency: 5, ...QUIET },
  );
  emailWorker.on('failed', (job, err) => logger.error({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'E-mail job failed'));
  const generations = new GenerationsService(logger);
  const generationWorker = new Worker<GenerationJob>(
    QUEUE_NAMES.generations,
    async (job) => {
      await generations.recalculate(new Types.ObjectId(job.data.familyId));
    },
    // One family at a time per worker keeps memory predictable for very large trees.
    { connection, concurrency: 1, ...QUIET },
  );
  generationWorker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'Generation job failed'));

  const lifecycle = new LifecycleService(
    { familyGraceDays: env.FAMILY_DELETION_GRACE_DAYS, mediaRetentionDays: env.MEDIA_RETENTION_DAYS },
    new PasswordHasher({ memoryCost: env.ARGON2_MEMORY_KIB, timeCost: env.ARGON2_TIME_COST, parallelism: env.ARGON2_PARALLELISM }),
    storageFromEnv(env),
    new AuditService(),
    logger,
  );
  // The purge and reminders used to be BullMQ schedules. A scheduled job always waiting in the queue made its worker
  // poll Redis every 10 seconds (BullMQ's limit), so they now run on timers below; remove the old schedules.
  const maintenance = new Queue(QUEUE_NAMES.maintenance, { connection });
  await Promise.all([maintenance.removeJobScheduler('purge'), maintenance.removeJobScheduler('reminders')]).catch((err: unknown) =>
    logger.warn({ err }, 'Could not remove the old maintenance schedules'),
  );
  await maintenance.obliterate({ force: true }).catch(() => undefined);
  await maintenance.close();
  const { notifications, email } = notificationsFromEnv(env, logger, connection);
  // Ceremony announcements: sent when due (held ones wait for the morning), reminders the day before.
  const announcements = new AnnouncementsService(
    { appOrigin: env.APP_ORIGIN, secret: env.CSRF_SECRET, smsPricePesewas: env.SMS_PRICE_PESEWAS, smsMonthlyLimit: env.SMS_MONTHLY_LIMIT_PER_FAMILY, timezone: env.MESSAGING_TIMEZONE, quietHours: env.MESSAGING_QUIET_HOURS },
    messagingFromEnv(env, logger),
    email,
    notifications,
    new BranchesService(new AuditService(), new GenerationScheduler(generations, logger)),
    new AuditService(),
    logger,
  );
  const announcementWorker = new Worker<{ announcementId: string }>(QUEUE_NAMES.announcements, async (job) => announcements.deliver(job.data.announcementId), { connection, concurrency: 2, ...QUIET });
  announcementWorker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'Announcement job failed'));
  // Every run is safe to repeat (each reminder and announcement is claimed once, the purge only removes what is
  // due), so with several workers the runs may overlap without sending anything twice.
  const every = (name: string, ms: number, task: () => Promise<unknown>, firstAfterMs: number) => {
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        await task();
      } catch (err) {
        logger.error({ err }, `Maintenance: ${name} failed`);
      } finally {
        running = false;
      }
    };
    const first = setTimeout(() => void run(), firstAfterMs);
    const timer = setInterval(() => void run(), ms);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  };
  const stopReminders = every('reminders', REMINDERS_EVERY_MS, () => Promise.all([notifications.run(), announcements.runDue()]), 60_000);
  const stopPurge = every('purge', PURGE_EVERY_MS, () => lifecycle.purge(), 10 * 60_000);
  // Automatic transcripts: a few at a time, they are slow and the speech-to-text service has its own limits.
  const transcription = new TranscriptionService(storageFromEnv(env), transcriberFromEnv(env, logger), new AuditService(), logger);
  const transcriptionWorker = new Worker<TranscriptionJob>(QUEUE_NAMES.transcriptions, async (job) => transcription.process(job.data), { connection, concurrency: 2, ...QUIET });
  transcriptionWorker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'Transcription job failed'));
  // Family books: one at a time, they read many photos and can be large.
  const books = new BookService(storageFromEnv(env), new AuditService(), logger);
  const bookWorker = new Worker<{ bookId: string }>(QUEUE_NAMES.books, async (job) => books.process(job.data), { connection, concurrency: 1, ...QUIET });
  bookWorker.on('failed', (job, err) => logger.error({ err, jobId: job?.id }, 'Book job failed'));
  logger.info('Worker started');

  const shutdown = async () => {
    stopReminders();
    stopPurge();
    await emailWorker.close();
    await generationWorker.close();
    await transcriptionWorker.close();
    await bookWorker.close();
    await announcementWorker.close();
    await email.close();
    await connection.quit();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
