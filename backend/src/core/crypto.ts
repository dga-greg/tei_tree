import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes so a database leak does not leak live tokens. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
