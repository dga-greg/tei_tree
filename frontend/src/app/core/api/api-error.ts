import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import type { ApiErrorBody, ApiErrorDetail, ErrorCode } from '@fh/contracts';
import { t, translateMessage } from '../i18n/i18n';

/** A normalised API failure that UI code can display without knowing about HTTP. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly status: number,
    readonly details: ApiErrorDetail[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  fieldError(path: string): string | undefined {
    return this.details.find((d) => d.path === path)?.message;
  }

  static from(err: unknown): ApiError {
    if (err instanceof ApiError) return err;
    if (err instanceof TimeoutError) {
      return new ApiError('NETWORK', t('The server is not responding. Check that it is running, then try again.'), 0);
    }
    if (err instanceof HttpErrorResponse) {
      const body = err.error as Partial<ApiErrorBody> | null;
      if (body?.error?.code) {
        const details = (body.error.details ?? []).map((d) => ({ ...d, message: translateMessage(d.message) }));
        return new ApiError(body.error.code, translateMessage(body.error.message), err.status, details, body.error.requestId);
      }
      if (err.status === 0) {
        return new ApiError('NETWORK', t('Cannot reach the server. Check your connection and try again.'), 0);
      }
      return new ApiError('INTERNAL', t('Something went wrong. Please try again later.'), err.status);
    }
    return new ApiError('INTERNAL', t('Something went wrong. Please try again later.'), 0);
  }
}
