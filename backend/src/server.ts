import path from 'node:path';
import { loadEnv } from './config/env.js';
import { createLogger } from './core/logger.js';
import { connectMongo, disconnectMongo, syncIndexes } from './infra/mongo.js';
import { createRedis } from './infra/redis.js';
import { LogMailer, SmtpMailer } from './infra/mailer.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  await connectMongo(env.MONGODB_URI, logger);
  const redis = env.REDIS_URL ? createRedis(env.REDIS_URL, logger, env.REDIS_TLS_VERIFY) : undefined;
  if (env.NODE_ENV === 'production' && env.ALLOW_INSECURE_HTTP) {
    logger.warn('ALLOW_INSECURE_HTTP is set: plain-HTTP origin and non-secure cookies are allowed. Never use this on a public server.');
  }
  if (!redis) logger.warn('REDIS_URL not set: using in-memory rate limits and inline e-mail delivery (development only)');

  const { app, close, lifecycle, notifications, announcements } = createApp({
    env,
    logger,
    redis,
    mailer: env.SMTP_URL ? new SmtpMailer(env.SMTP_URL, env.MAIL_FROM) : new LogMailer(logger),
  });
  await syncIndexes(logger);

  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, storage: env.STORAGE_DRIVER === 's3' ? `s3 (${env.S3_BUCKET} at ${env.S3_ENDPOINT ?? 'AWS'})` : `local (${path.resolve(env.MEDIA_LOCAL_DIR)})` }, 'API listening'));
  // With Redis the worker runs the purge on a schedule; without it (development) the API does.
  const purgeTimer = redis ? null : setInterval(() => void lifecycle.purge().catch((err: unknown) => logger.error({ err }, 'Purge failed')), 6 * 60 * 60 * 1000);
  purgeTimer?.unref();
  // Likewise for reminders: every hour, each person gets what is due in their own time zone.
  const remindersTimer = redis ? null : setInterval(() => void notifications.run().catch((err: unknown) => logger.error({ err }, 'Reminders failed')), 60 * 60 * 1000);
  remindersTimer?.unref();
  // And for announcements held for the night, and the day-before reminders.
  const announcementsTimer = redis ? null : setInterval(() => void announcements.runDue().catch((err: unknown) => logger.error({ err }, 'Announcements failed')), 5 * 60 * 1000);
  announcementsTimer?.unref();

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await close();
      await redis?.quit();
      await disconnectMongo();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
