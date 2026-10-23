import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';

const ISSUER = 'family-heritage';
const AUDIENCE = 'family-heritage-api';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export type VerifyResult = { ok: true; claims: AccessTokenClaims } | { ok: false; reason: 'expired' | 'invalid' };

/** Short-lived JWT access tokens (HS256). Revocation is enforced by checking the session on use. */
export class AccessTokenService {
  constructor(
    private readonly secret: string,
    readonly ttlSeconds: number,
  ) {}

  sign(userId: Types.ObjectId, sessionId: Types.ObjectId): { token: string; expiresAt: Date } {
    const token = jwt.sign({ sid: sessionId.toString() }, this.secret, {
      algorithm: 'HS256',
      subject: userId.toString(),
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.ttlSeconds,
    });
    return { token, expiresAt: new Date(Date.now() + this.ttlSeconds * 1000) };
  }

  verify(token: string): VerifyResult {
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') {
        return { ok: false, reason: 'invalid' };
      }
      return { ok: true, claims: { userId: payload.sub, sessionId: payload['sid'] as string } };
    } catch (err) {
      return { ok: false, reason: err instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
    }
  }
}
