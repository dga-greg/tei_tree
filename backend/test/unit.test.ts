import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { CsrfProtection } from '../src/middleware/csrf.js';
import { AccessTokenService } from '../src/modules/auth/tokens.js';
import { Types } from 'mongoose';

describe('environment validation', () => {
  const base = {
    APP_ORIGIN: 'https://heritage.example.org',
    MONGODB_URI: 'mongodb://db/fh',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    CSRF_SECRET: 'y'.repeat(32),
  };

  it('rejects short secrets', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('requires SMTP, object storage and secure cookies in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SMTP_URL[\s\S]*STORAGE_DRIVER/);
    const prod = { ...base, NODE_ENV: 'production', SMTP_URL: 'smtp://s', STORAGE_DRIVER: 's3', S3_BUCKET: 'family-media' };
    expect(() => loadEnv({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadEnv({ ...prod, S3_BUCKET: '' })).toThrow(/S3_BUCKET/);
    // Plain HTTP only with the explicit local-trial switch.
    expect(loadEnv({ ...prod, APP_ORIGIN: 'http://localhost:8080', COOKIE_SECURE: 'false', ALLOW_INSECURE_HTTP: 'true' }).COOKIE_SECURE).toBe(false);
    const env = loadEnv(prod);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('defaults to insecure cookies only outside production', () => {
    expect(loadEnv({ ...base, APP_ORIGIN: 'http://localhost:4200' }).COOKIE_SECURE).toBe(false);
  });
});

describe('CSRF tokens', () => {
  const csrf = new CsrfProtection('s'.repeat(32), {});

  it('accepts only tokens signed with the server secret', () => {
    const res = () => ({ cookie: () => undefined, locals: {} }) as never;
    const token = csrf.issue(res());
    expect(csrf.isValid(token)).toBe(true);
    expect(csrf.isValid(token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBe(false);
    expect(csrf.isValid(new CsrfProtection('t'.repeat(32), {}).issue(res()))).toBe(false);
    expect(csrf.isValid('a.b.c')).toBe(false);
    expect(csrf.isValid(undefined)).toBe(false);
  });
});

describe('access tokens', () => {
  it('round-trips claims and rejects tampering', () => {
    const svc = new AccessTokenService('k'.repeat(32), 900);
    const userId = new Types.ObjectId();
    const sessionId = new Types.ObjectId();
    const { token } = svc.sign(userId, sessionId);
    expect(svc.verify(token)).toEqual({ ok: true, claims: { userId: userId.toString(), sessionId: sessionId.toString() } });
    const [h, p, s] = token.split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: 'x', sid: 'y' })).toString('base64url')}.${s}`;
    expect(svc.verify(tampered)).toEqual({ ok: false, reason: 'invalid' });
    expect(new AccessTokenService('z'.repeat(32), 900).verify(token)).toEqual({ ok: false, reason: 'invalid' });
    void p;
  });
});

describe('log redaction', () => {
  it('keeps signed file links out of logs', async () => {
    const { redactUrl } = await import('../src/core/logger.js');
    expect(redactUrl('/api/v1/files/eyJrIjoiYSJ9.c2ln?x=1')).toBe('/api/v1/files/[redacted]?x=1');
    expect(redactUrl('/api/v1/families/abc/members')).toBe('/api/v1/families/abc/members');
  });
});
