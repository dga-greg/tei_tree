import type { ApiErrorDetail, ErrorCode } from '@fh/contracts';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  CSRF_INVALID: 403,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  VERSION_CONFLICT: 409,
  ACCOUNT_LOCKED: 423,
  MFA_REQUIRED: 403,
  MFA_INVALID: 401,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL: 500,
};

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ApiErrorDetail[],
    status?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status ?? STATUS_BY_CODE[code];
  }

  static notFound(what = 'Resource'): AppError {
    return new AppError('NOT_FOUND', `${what} not found`);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }
}
