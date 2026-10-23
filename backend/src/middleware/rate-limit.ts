import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { AppError } from '../core/errors.js';

/**
 * Rate limits are counted in the memory of the API process. The app runs as one process (one Heroku web dyno),
 * so every request is counted in the same place; a restart simply starts the counts again.
 */
function limiter(options: { windowMs: number; limit: number }): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED', 'Too many requests. Please wait and try again.')),
  });
}

export function globalRateLimit(perMinute: number): RequestHandler {
  return limiter({ windowMs: 60_000, limit: perMinute });
}

/** Stricter limit for credential endpoints (login, register, password recovery). */
export function authRateLimit(per15Minutes: number): RequestHandler {
  return limiter({ windowMs: 15 * 60_000, limit: per15Minutes });
}

/** Uploads are expensive (disk, image processing, storage); limit them per client. */
export function uploadRateLimit(per15Minutes: number): RequestHandler {
  return limiter({ windowMs: 15 * 60_000, limit: per15Minutes });
}

/** Signed file links: generous, since a page loads many thumbnails. */
export function fileRateLimit(perMinute: number): RequestHandler {
  return limiter({ windowMs: 60_000, limit: perMinute });
}
