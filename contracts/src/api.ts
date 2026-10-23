/** Response envelope and error vocabulary shared by the API and its clients. */

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiPage<T> {
  data: T[];
  meta: PageMeta;
}

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'CSRF_INVALID',
  'FORBIDDEN',
  'ACCOUNT_SUSPENDED',
  'NOT_FOUND',
  'CONFLICT',
  'EMAIL_TAKEN',
  'VERSION_CONFLICT',
  'ACCOUNT_LOCKED',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorDetail {
  /** Dot-separated path of the offending field, e.g. `origin.country`. Empty for form-level errors. */
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
}

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;
