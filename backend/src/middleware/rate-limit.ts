import { rateLimit, type Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { RequestHandler } from 'express';
import type { Redis } from '../infra/redis.js';
import { AppError } from '../core/errors.js';

/** How long a rate-limit lookup may wait for Redis before the request goes ahead without it. */
const STORE_TIMEOUT_MS = 2000;

function store(redis: Redis | undefined, prefix: string): Store | undefined {
  if (!redis) return undefined; // in-memory (single instance, development only)
  const redisStore = new RedisStore({
    prefix: `rl:${prefix}:`,
    // Redis that is down or unreachable must not hang every request: give up after a moment (see passOnStoreError).
    sendCommand: (command: string, ...args: string[]) =>
      Promise.race([
        redis.call(command, ...args) as Promise<RedisReply>,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Redis did not answer within ${STORE_TIMEOUT_MS} ms (is it running?)`)), STORE_TIMEOUT_MS).unref()),
      ]),
  });
  // The store loads its scripts as soon as it is made; with Redis down those promises fail before anything awaits
  // them, and an unhandled rejection would stop the process. Requests that use them still see the failure.
  for (const loading of [redisStore.incrementScriptSha, redisStore.getScriptSha]) void Promise.resolve(loading).catch(() => undefined);
  return redisStore;
}

function limiter(options: { windowMs: number; limit: number; prefix: string; redis?: Redis }): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: store(options.redis, options.prefix),
    // Without Redis, let requests through rather than refusing everyone; the error is logged.
    passOnStoreError: true,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 'Too many requests. Please wait and try again.')),
  });
}

export function globalRateLimit(perMinute: number, redis?: Redis): RequestHandler {
  return limiter({ windowMs: 60_000, limit: perMinute, prefix: 'global', redis });
}

/** Stricter limit for credential endpoints (login, register, password recovery). */
export function authRateLimit(per15Minutes: number, redis?: Redis): RequestHandler {
  return limiter({ windowMs: 15 * 60_000, limit: per15Minutes, prefix: 'auth', redis });
}

/** Uploads are expensive (disk, image processing, storage); limit them per client. */
export function uploadRateLimit(per15Minutes: number, redis?: Redis): RequestHandler {
  return limiter({ windowMs: 15 * 60_000, limit: per15Minutes, prefix: 'upload', redis });
}

/** Signed file links: generous, since a gallery page loads many thumbnails. */
export function fileRateLimit(perMinute: number, redis?: Redis): RequestHandler {
  return limiter({ windowMs: 60_000, limit: perMinute, prefix: 'files', redis });
}
