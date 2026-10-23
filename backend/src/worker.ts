import { Worker } from 'bullmq';
import { Types } from 'mongoose';
import { loadEnv } from './config/env.js';
import { createLogger } from './core/logger.js';
import { connectMongo, disconnectMongo } from './infra/mongo.js';
import { createRedis } from './infra/redis.js';
import { LogMailer, SmtpMailer } from './infra/mailer.js';
import { QUEUE_NAMES, type EmailJob } from './infra/queues.js';
import { GenerationsService } from './modules/generations/generations.service.js';
import type { GenerationJob } from './modules/generations/generation-scheduler.js';
import './modules/models.js';

/**
 * Keeps idle workers quiet on Redis. By default each worker asks Redis for work every 5 seconds and checks for
 * stalled jobs every 30, which uses up a hosted Redis plan (Upstash's free tier) within days. A new job still wakes
 * a waiting worker at once (BullMQ signals it), so waiting longer between checks does not delay anything; a job left
 * behind by a crashed worker is retried within half an hour.
 */
const QUIET = { drainDelay: 600, stalledInterval: 30 * 60 * 1000 };

/** Background worker: outgoing e-mail, and generation recalculation for large families. */
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
  logger.info('Worker started');

  const shutdown = async () => {
    await emailWorker.close();
    await generationWorker.close();
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
