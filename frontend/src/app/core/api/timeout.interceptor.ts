import type { HttpInterceptorFn } from '@angular/common/http';
import { timeout } from 'rxjs';

/** Requests the server never answers fail after this long (uploads, which can take minutes, are left alone). */
export const REQUEST_TIMEOUT_MS = 30_000;

export const timeoutInterceptor: HttpInterceptorFn = (req, next) =>
  req.body instanceof FormData ? next(req) : next(req).pipe(timeout({ first: REQUEST_TIMEOUT_MS }));
