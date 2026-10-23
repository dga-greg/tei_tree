import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import type { ApiErrorBody } from '@fh/contracts';
import { API_BASE } from '../api/api';
import { AuthStore } from './auth.store';
import { SessionRefresher } from './session-refresher';

/** Endpoints whose 401 means "wrong credentials / no session", never "please refresh". */
const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email', '/invitations/preview'].map(
  (p) => API_BASE + p,
);

function needsRefresh(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse) || err.status !== 401) return false;
  const code = (err.error as Partial<ApiErrorBody> | null)?.error?.code;
  return code === 'UNAUTHENTICATED' || code === 'SESSION_EXPIRED';
}

/**
 * On a 401 from the API, renews the session once using the refresh cookie and retries the request.
 * If renewal fails, the user is signed out locally and sent to the sign-in page.
 */
export const authRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(API_BASE) || NO_REFRESH.some((p) => req.url.startsWith(p))) return next(req);
  const refresher = inject(SessionRefresher);
  const store = inject(AuthStore);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (!needsRefresh(err)) return throwError(() => err);
      return refresher.refresh().pipe(
        catchError(() => {
          store.sessionEnded();
          return throwError(() => err);
        }),
        switchMap(() => next(req)),
      );
    }),
  );
};
