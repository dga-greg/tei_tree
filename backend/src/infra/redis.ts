import { Redis } from 'ioredis';
import type { Logger } from '../core/logger.js';

/**
 * `verifyTls: false` is for managed Redis that presents a self-signed certificate over rediss:// (Heroku Key-Value
 * Store); the connection is still encrypted.
 */
export function createRedis(url: string, logger: Logger, verifyTls = true): Redis {
  const redis = new Redis(url, {
    // Required by BullMQ for blocking commands.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...(url.startsWith('rediss://') && !verifyTls ? { tls: { rejectUnauthorized: false } } : {}),
  });
  redis.on('error', (err) => logger.error({ err }, 'Redis error'));
  redis.on('ready', () => logger.info('Redis connected'));
  return redis;
}

export type { Redis };
