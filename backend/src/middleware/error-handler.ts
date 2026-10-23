import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import type { ApiErrorBody } from '@fh/contracts';
import { AppError } from '../core/errors.js';
import { redactUrl, type Logger } from '../core/logger.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound('Endpoint'));
};

function normalise(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof mongoose.Error.VersionError) {
    return new AppError('VERSION_CONFLICT', 'This record was changed by someone else. Reload and try again.');
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return new AppError(
      'VALIDATION_FAILED',
      'Validation failed',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: unknown; type?: unknown; status?: unknown };
    if (e.code === 11000) return new AppError('CONFLICT', 'A record with these details already exists');
    // body-parser errors
    if (e.type === 'entity.parse.failed') return new AppError('VALIDATION_FAILED', 'Malformed JSON body');
    if (e.type === 'entity.too.large') return new AppError('VALIDATION_FAILED', 'Request body too large', undefined, 413);
  }
  return null;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    const appError = normalise(err);
    if (!appError || appError.status >= 500) {
      logger.error({ err, requestId: req.requestId, path: redactUrl(req.originalUrl.split('?')[0]) }, 'Unhandled error');
    }
    const error = appError ?? new AppError('INTERNAL', 'Something went wrong. Please try again later.');
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        requestId: req.requestId,
      },
    };
    if (res.headersSent) return;
    res.status(error.status).json(body);
  };
}
