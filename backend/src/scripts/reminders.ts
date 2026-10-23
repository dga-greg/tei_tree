import { loadEnv } from '../config/env.js';
import { createLogger } from '../core/logger.js';
import { connectMongo, disconnectMongo } from '../infra/mongo.js';
import { notificationsFromEnv } from '../modules/notifications/notifications.factory.js';
import '../modules/models.js';

/** Sends the reminders that are due now (e.g. hourly from cron when no worker is deployed): `npm run reminders -w backend`. */
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
await connectMongo(env.MONGODB_URI, logger);
const { notifications, email } = notificationsFromEnv(env, logger);
const result = await notifications.run();
logger.info(result, 'Reminders sent');
await email.close();
await disconnectMongo();
