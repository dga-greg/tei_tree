import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { safeEqual } from '../../core/crypto.js';

/**
 * Time-based one-time passwords (RFC 6238) as authenticator apps make them: HMAC-SHA1, 30-second steps, 6 digits.
 */
export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Codes from one step before or after are accepted too, for clocks that drift and slow typists. */
const WINDOW = 1;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 as apps expect it. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return binary.toString().padStart(DIGITS, '0');
}

/**
 * The step a code belongs to, if it is valid now and newer than `lastUsedStep` (a code is never accepted twice).
 * Checks every step in the window so the time taken does not reveal which one matched.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep: number | null, now = Date.now()): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const current = totpStep(now);
  let match: number | null = null;
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    if (safeEqual(totpCode(secret, step), typed) && (lastUsedStep == null || step > lastUsedStep)) match ??= step;
  }
  return match;
}

export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** "k7mq-x4tp-9hza": 12 characters from an alphabet without look-alikes, about 59 bits each. */
export function recoveryCode(): string {
  const chars = Array.from({ length: 12 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

export function normaliseRecoveryCode(code: string): string {
  const c = code.toLowerCase().replace(/[^a-z0-9]/g, '');
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}` : c;
}
