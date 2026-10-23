import path from 'node:path';
import { loadEnv } from './config/env.js';
import { createLogger } from './core/logger.js';
import { connectMongo, disconnectMongo, syncIndexes } from './infra/mongo.js';
import { LogMailer, SmtpMailer } from './infra/mailer.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  await connectMongo(env.MONGODB_URI, logger);
  if (env.NODE_ENV === 'production' && env.ALLOW_INSECURE_HTTP) {
    logger.warn('ALLOW_INSECURE_HTTP is set: plain-HTTP origin and non-secure cookies are allowed. Never use this on a public server.');
  }

  const { app, close } = createApp({
    env,
    logger,
    mailer: env.SMTP_URL ? new SmtpMailer(env.SMTP_URL, env.MAIL_FROM) : new LogMailer(logger),
  });
  await syncIndexes(logger);

  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, storage: env.STORAGE_DRIVER === 's3' ? `s3 (${env.S3_BUCKET} at ${env.S3_ENDPOINT ?? 'AWS'})` : `local (${path.resolve(env.MEDIA_LOCAL_DIR)})` }, 'API listening'));
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await close();
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
