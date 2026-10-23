import { loadEnv } from '../config/env.js';
import { createLogger } from '../core/logger.js';
import { connectMongo, disconnectMongo } from '../infra/mongo.js';
import { storageFromEnv } from '../infra/storage.js';
import { AuditService } from '../modules/audit/audit.service.js';
import { PasswordHasher } from '../modules/auth/password.js';
import { LifecycleService } from '../modules/lifecycle/lifecycle.service.js';
import '../modules/models.js';

/** Runs the purge once (e.g. from cron when no worker is deployed): `npm run purge -w backend`. */
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
await connectMongo(env.MONGODB_URI, logger);
const lifecycle = new LifecycleService(
  { familyGraceDays: env.FAMILY_DELETION_GRACE_DAYS, mediaRetentionDays: env.MEDIA_RETENTION_DAYS },
  new PasswordHasher({ memoryCost: env.ARGON2_MEMORY_KIB, timeCost: env.ARGON2_TIME_COST, parallelism: env.ARGON2_PARALLELISM }),
  storageFromEnv(env),
  new AuditService(),
  logger,
);
const result = await lifecycle.purge();
logger.info(result, 'Purge finished');
await disconnectMongo();
