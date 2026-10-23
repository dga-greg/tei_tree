import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { AppError } from '../core/errors.js';
import { hmac, randomToken, safeEqual } from '../core/crypto.js';

export const CSRF_COOKIE = 'XSRF-TOKEN';
export const CSRF_HEADER = 'x-xsrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signed double-submit CSRF protection.
 * The token is `<nonce>.<hmac(nonce)>`; it is readable by the SPA (not HttpOnly) and must be echoed
 * in the X-XSRF-TOKEN header on every state-changing request. The HMAC prevents an attacker who can
 * plant cookies (e.g. from a sibling sub-domain) from choosing a token value the server will accept.
 */
export class CsrfProtection {
  constructor(
    private readonly secret: string,
    private readonly cookieOptions: CookieOptions,
  ) {}

  /** Sets a fresh token cookie. Idempotent within one response so the client never sees two values. */
  issue(res: Response): string {
    const existing: unknown = res.locals['csrfToken'];
    if (typeof existing === 'string') return existing;
    const nonce = randomToken(18);
    const token = `${nonce}.${hmac(this.secret, nonce)}`;
    res.cookie(CSRF_COOKIE, token, { ...this.cookieOptions, httpOnly: false });
    res.locals['csrfToken'] = token;
    return token;
  }

  isValid(token: unknown): token is string {
    if (typeof token !== 'string' || token.length > 200) return false;
    const [nonce, signature, extra] = token.split('.');
    if (!nonce || !signature || extra !== undefined) return false;
    return safeEqual(signature, hmac(this.secret, nonce));
  }

  /** Ensures every client holds a valid token, so the SPA can send one on its first POST. */
  readonly ensureCookie: RequestHandler = (req, res, next) => {
    const current: unknown = req.cookies?.[CSRF_COOKIE];
    if (this.isValid(current)) res.locals['currentCsrfToken'] = current;
    else this.issue(res);
    next();
  };

  /** The token the client will hold after this response. */
  tokenFor(res: Response): string {
    const current: unknown = res.locals['csrfToken'] ?? res.locals['currentCsrfToken'];
    return typeof current === 'string' ? current : this.issue(res);
  }

  readonly verify: RequestHandler = (req: Request, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const header = req.get(CSRF_HEADER);
    if (!this.isValid(cookie) || !header || !safeEqual(header, cookie)) {
      return next(new AppError('CSRF_INVALID', 'Missing or invalid CSRF token. Reload the page and try again.'));
    }
    next();
  };
}
