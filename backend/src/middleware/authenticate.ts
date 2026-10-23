import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { canPlatform, type PlatformPermission } from '@fh/contracts';
import { AppError } from '../core/errors.js';
import { AuthSessionModel } from '../modules/auth/session.model.js';
import { UserModel, type UserDoc } from '../modules/users/user.model.js';
import { ACCESS_COOKIE } from '../modules/auth/cookies.js';
import type { AccessTokenService } from '../modules/auth/tokens.js';

export interface AuthContext {
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
  user: UserDoc;
}

/**
 * Resolves the caller from the access-token cookie. Never rejects on its own — routes decide with
 * `requireAuth`, so the same route can serve guests and members (e.g. public families).
 * The session is checked on every request so that logout, password changes and suspensions take
 * effect immediately rather than when the access token expires.
 */
export function authenticate(tokens: AccessTokenService): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || token.length === 0) return next();

    const result = tokens.verify(token);
    if (!result.ok) {
      req.authFailure = result.reason;
      return next();
    }
    const { userId, sessionId } = result.claims;
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(sessionId)) {
      req.authFailure = 'invalid';
      return next();
    }

    const session = await AuthSessionModel.exists({
      _id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });
    const user = session ? await UserModel.findById(userId) : null;
    if (!session || !user || user.status !== 'active') {
      req.authFailure = 'invalid';
      return next();
    }

    req.auth = { userId: user._id, sessionId: new Types.ObjectId(sessionId), user };
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (req.auth) return next();
  if (req.authFailure === 'expired') return next(new AppError('SESSION_EXPIRED', 'Your session has expired'));
  next(AppError.unauthenticated());
};

/** Narrows `req.auth` for handlers mounted behind `requireAuth`. */
export function authOf(req: Express.Request): AuthContext {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}

export function requirePlatformPermission(permission: PlatformPermission): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(AppError.unauthenticated());
    if (!canPlatform(auth.user.platformRole, permission)) return next(AppError.forbidden());
    next();
  };
}
