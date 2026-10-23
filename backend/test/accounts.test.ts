import { createHash, generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpGoogleIdentity, type GoogleAuthorizeParams, type GoogleIdentity, type GoogleProfile } from '../src/modules/auth/google.js';
import { safeNext } from '../src/modules/auth/google.service.js';
import { MfaChallengeModel } from '../src/modules/auth/mfa-challenge.model.js';
import { SecretBox } from '../src/modules/auth/secret-box.js';
import { base32Decode, base32Encode, totpCode, totpStep, verifyTotp } from '../src/modules/auth/totp.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TEST_PASSWORD, TestClient, type TestContext } from './helpers.js';

// ------------------------------------------------------------------ units

describe('one-time codes', () => {
  it('match the RFC 6238 test vectors', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpCode(secret, totpStep(59_000))).toBe('287082');
    expect(totpCode(secret, totpStep(1_111_111_109_000))).toBe('081804');
    expect(totpCode(secret, totpStep(2_000_000_000_000))).toBe('279037');
  });

  it('accept the neighbouring steps, never an older or reused one', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_111_111_109_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, totpCode(secret, step), null, now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, `${totpCode(secret, step).slice(0, 3)} ${totpCode(secret, step).slice(3)}`, null, now)).toBe(step);
    expect(verifyTotp(secret, 'abcdef', null, now)).toBeNull();
  });

  it('keeps secrets sealed, and refuses tampered ones', () => {
    const box = new SecretBox('a-test-key-that-is-long-enough-for-hkdf');
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    const parts = sealed.split('.');
    parts[2] = Buffer.from('JBSWY3DPEHPK3PXQ').toString('base64url');
    expect(() => box.open(parts.join('.'))).toThrow();
    expect(() => new SecretBox('another-key-that-is-long-enough-for-it').open(sealed)).toThrow();
  });

  it('only returns to paths inside the app', () => {
    expect(safeNext('/members/1?tab=a')).toBe('/members/1?tab=a');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', 42, '/a b']) expect(safeNext(bad)).toBe('/dashboard');
  });
});

describe('Google ID tokens', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const fetcher = (async (url: string | URL) => {
    if (String(url).includes('certs')) return new Response(JSON.stringify({ keys: [jwk] }));
    return new Response(JSON.stringify({ id_token: token({}) }));
  }) as typeof fetch;
  const token = (claims: Record<string, unknown>, opts: jwt.SignOptions = {}) =>
    jwt.sign({ email: 'Kofi@Gmail.com', email_verified: true, name: 'Kofi Mensah', nonce: 'n1', ...claims }, privateKey, {
      algorithm: 'RS256', keyid: 'k1', audience: 'client-1', issuer: 'https://accounts.google.com', subject: 'g-123', expiresIn: 300, ...opts,
    });
  const google = new HttpGoogleIdentity('client-1', 'secret', fetcher);

  it('checks the signature, audience, issuer and nonce', async () => {
    await expect(google.verifyIdToken(token({}), 'n1')).resolves.toEqual({ sub: 'g-123', email: 'kofi@gmail.com', emailVerified: true, name: 'Kofi Mensah', hostedDomain: null });
    await expect(google.exchange('code', 'verifier', 'https://app/cb', 'n1')).resolves.toMatchObject({ sub: 'g-123' });
    await expect(google.verifyIdToken(token({}), 'other')).rejects.toThrow(/nonce/);
    await expect(google.verifyIdToken(token({}, { audience: 'someone-else' }), 'n1')).rejects.toThrow(/audience/);
    await expect(google.verifyIdToken(token({}, { issuer: 'https://evil.example' }), 'n1')).rejects.toThrow(/issuer/);
    await expect(google.verifyIdToken(token({}, { expiresIn: -10 }), 'n1')).rejects.toThrow(/expired/);
    const forger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const forged = jwt.sign({ email: 'x@gmail.com', nonce: 'n1' }, forger, { algorithm: 'RS256', keyid: 'k1', audience: 'client-1', issuer: 'https://accounts.google.com', subject: 'g-1' });
    await expect(google.verifyIdToken(forged, 'n1')).rejects.toThrow(/signature/);
    const url = new URL(google.authorizeUrl({ state: 's', nonce: 'n', codeChallenge: 'c', redirectUri: 'https://app/cb' }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'client-1', state: 's', nonce: 'n', code_challenge: 'c', code_challenge_method: 'S256', scope: 'openid email profile' });
  });
});

// ------------------------------------------------------------------ through the API

/** Stands in for Google: hands out a fixed profile, after checking the PKCE verifier and nonce like Google would. */
class FakeGoogle implements GoogleIdentity {
  readonly enabled = true;
  profile: GoogleProfile = { sub: 'g-1', email: 'esi@gmail.com', emailVerified: true, name: 'Esi Mensah', hostedDomain: null };
  private pending = new Map<string, GoogleAuthorizeParams>();

  authorizeUrl(p: GoogleAuthorizeParams): string {
    this.pending.set(p.state, p);
    return `https://accounts.google.test/auth?state=${p.state}`;
  }

  async exchange(code: string, verifier: string, redirectUri: string, nonce: string): Promise<GoogleProfile> {
    const p = this.pending.get(code);
    if (!p || p.nonce !== nonce || p.redirectUri !== redirectUri || p.codeChallenge !== createHash('sha256').update(verifier).digest('base64url')) throw new Error('bad exchange');
    return this.profile;
  }
}

let ctx: TestContext;
let google: FakeGoogle;

const now = (secret: string, offset = 0) => totpCode(secret, totpStep() + offset);
const waitForMail = async (to: string, subject: RegExp) => {
  for (let i = 0; i < 50; i++) {
    const m = ctx.mailer.outbox.find((x) => x.to === to && subject.test(x.subject));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`No e-mail "${subject}" to ${to}`);
};

/**
 * Turns on two-step sign-in for a signed-in client. `next(n)` is the code n steps after the one used to turn it on:
 * valid (and not yet used) for the next half minute or so, whatever the clock does meanwhile.
 */
async function enableMfa(client: TestClient): Promise<{ secret: string; codes: string[]; used: string; next: (n?: number) => string }> {
  const setup = await client.post('/auth/mfa/totp/setup', { password: TEST_PASSWORD });
  expect(setup.status).toBe(200);
  const secret = setup.body.data.secret as string;
  const step = totpStep();
  const used = totpCode(secret, step);
  const enabled = await client.post('/auth/mfa/totp/enable', { code: used });
  expect(enabled.status).toBe(200);
  return { secret, codes: enabled.body.data.codes, used, next: (n = 1) => totpCode(secret, step + n) };
}

async function passwordStep(email: string): Promise<{ client: TestClient; challenge: string }> {
  const client = await new TestClient(ctx).init();
  const res = await client.post('/auth/login', { email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ mfaRequired: true });
  return { client, challenge: res.body.data.challenge };
}

/** Follows the Google redirect dance with the fake: start → (Google) → callback. Returns the callback response. */
async function viaGoogle(client: TestClient, query = '') {
  const start = await client.agent.get(`/api/v1/auth/google/start${query}`);
  expect(start.status).toBe(302);
  const state = new URL(start.headers['location'] as string).searchParams.get('state')!;
  return client.track(await client.agent.get(`/api/v1/auth/google/callback?state=${state}&code=${state}`));
}

beforeAll(async () => {
  await connectTestDb();
  google = new FakeGoogle();
  ctx = buildApp({ ADMIN_MFA_REQUIRED: 'true' }, { google });
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  ctx.mailer.outbox.length = 0;
  google.profile = { sub: 'g-1', email: 'esi@gmail.com', emailVerified: true, name: 'Esi Mensah', hostedDomain: null };
});

describe('two-step sign-in', () => {
  it('is turned on with a password and a first code, and signs out other devices', async () => {
    const ama = await registeredClient(ctx, 'ama@example.org', 'Ama');
    const laptop = await new TestClient(ctx).init();
    await laptop.post('/auth/login', { email: 'ama@example.org', password: TEST_PASSWORD });

    expect((await ama.post('/auth/mfa/totp/setup', { password: 'wrong password!!' })).status).toBe(400);
    const setup = await ama.post('/auth/mfa/totp/setup', { password: TEST_PASSWORD });
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\/Family%20Heritage%3Aama%40example\.org\?secret=[A-Z2-7]{32}&issuer=Family\+Heritage/);
    expect(setup.body.data.qrSvg).toContain('<svg');
    const secret = setup.body.data.secret as string;
    // The secret is stored encrypted.
    const stored = await UserModel.findOne({ email: 'ama@example.org' }).select('+mfa.pendingSecret');
    expect(stored!.mfa!.pendingSecret).not.toContain(secret);

    const wrong = await ama.post('/auth/mfa/totp/enable', { code: now(secret, 5) });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('MFA_INVALID');
    const on = await ama.post('/auth/mfa/totp/enable', { code: now(secret) });
    expect(on.body.data.codes).toHaveLength(10);
    expect(on.body.data.codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect((await ama.post('/auth/mfa/totp/setup', { password: TEST_PASSWORD })).status).toBe(409);
    expect((await ama.get('/auth/me')).body.data.user.security).toEqual({ hasPassword: true, mfaEnabled: true, mfaRequired: false, google: null });
    expect((await ama.get('/auth/mfa')).body.data).toMatchObject({ enabled: true, recoveryCodesLeft: 10, required: false });
    expect((await laptop.get('/auth/me')).status).toBe(401);
    await waitForMail('ama@example.org', /Two-step sign-in is on/);
  });

  it('asks for a code after the password; codes work once and challenges are single use', async () => {
    const ama = await registeredClient(ctx, 'ama@example.org', 'Ama');
    const { used, next } = await enableMfa(ama);

    const { client, challenge } = await passwordStep('ama@example.org');
    // No session yet.
    expect((await client.get('/auth/me')).status).toBe(401);
    // The code used to turn it on cannot be used again.
    const replay = await client.post('/auth/login/mfa', { challenge, code: used });
    expect(replay.body.error.code).toBe('MFA_INVALID');
    const ok = await client.post('/auth/login/mfa', { challenge, code: next() });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.email).toBe('ama@example.org');
    expect((await client.get('/auth/me')).status).toBe(200);
    expect((await client.post('/auth/login/mfa', { challenge, code: next() })).status).toBe(409);

    // Another sign-in cannot reuse that code either.
    const second = await passwordStep('ama@example.org');
    expect((await second.client.post('/auth/login/mfa', { challenge: second.challenge, code: next() })).body.error.code).toBe('MFA_INVALID');
    expect((await second.client.post('/auth/login/mfa', { challenge: 'x'.repeat(43), code: '123456' })).status).toBe(409);
    expect((await second.client.post('/auth/login/mfa', { challenge: second.challenge })).status).toBe(400);
  });

  it('limits guesses per challenge and locks the account after repeated wrong codes', async () => {
    const ama = await registeredClient(ctx, 'ama@example.org', 'Ama');
    const { next } = await enableMfa(ama);
    const { client, challenge } = await passwordStep('ama@example.org');
    for (let i = 0; i < 4; i++) expect((await client.post('/auth/login/mfa', { challenge, code: '000000' })).status).toBe(401);
    // The fifth wrong code locks the account (five failed attempts).
    expect((await client.post('/auth/login/mfa', { challenge, code: '000000' })).status).toBe(401);
    expect((await client.post('/auth/login/mfa', { challenge, code: next() })).status).toBe(409);
    const later = await new TestClient(ctx).init();
    expect((await later.post('/auth/login', { email: 'ama@example.org', password: TEST_PASSWORD })).body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await MfaChallengeModel.countDocuments()).toBe(1);
  });

  it('accepts each recovery code once, and new codes replace the old', async () => {
    const ama = await registeredClient(ctx, 'ama@example.org', 'Ama');
    const { codes, next } = await enableMfa(ama);
    const a = await passwordStep('ama@example.org');
    expect((await a.client.post('/auth/login/mfa', { challenge: a.challenge, recoveryCode: codes[0]!.toUpperCase().replace(/-/g, ' ') })).status).toBe(200);
    await waitForMail('ama@example.org', /recovery code was used/);
    const b = await passwordStep('ama@example.org');
    expect((await b.client.post('/auth/login/mfa', { challenge: b.challenge, recoveryCode: codes[0] })).status).toBe(401);
    expect((await ama.get('/auth/mfa')).body.data.recoveryCodesLeft).toBe(9);

    expect((await ama.post('/auth/mfa/recovery-codes', { password: TEST_PASSWORD })).status).toBe(401);
    const fresh = await ama.post('/auth/mfa/recovery-codes', { password: TEST_PASSWORD, code: next() });
    expect(fresh.body.data.codes).toHaveLength(10);
    const c = await passwordStep('ama@example.org');
    expect((await c.client.post('/auth/login/mfa', { challenge: c.challenge, recoveryCode: codes[1] })).status).toBe(401);
    expect((await c.client.post('/auth/login/mfa', { challenge: c.challenge, recoveryCode: fresh.body.data.codes[0] })).status).toBe(200);
  });

  it('is turned off with the password and a code', async () => {
    const ama = await registeredClient(ctx, 'ama@example.org', 'Ama');
    const { next } = await enableMfa(ama);
    expect((await ama.post('/auth/mfa/disable', { password: TEST_PASSWORD, code: '000000' })).status).toBe(401);
    expect((await ama.post('/auth/mfa/disable', { code: next() })).status).toBe(400);
    expect((await ama.post('/auth/mfa/disable', { password: TEST_PASSWORD, code: next() })).status).toBe(204);
    await waitForMail('ama@example.org', /turned off/);
    const client = await new TestClient(ctx).init();
    const res = await client.post('/auth/login', { email: 'ama@example.org', password: TEST_PASSWORD });
    expect(res.body.data.user.security.mfaEnabled).toBe(false);
    expect((await ama.post('/auth/mfa/disable', { password: TEST_PASSWORD })).status).toBe(409);
  });

  it('is required before platform administrators use the administration pages', async () => {
    const root = await registeredClient(ctx, 'root@example.org', 'Root');
    await UserModel.updateOne({ email: 'root@example.org' }, { platformRole: 'super_admin' });
    const refused = await root.get('/admin/stats');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('MFA_REQUIRED');
    expect((await root.get('/auth/me')).body.data.user.security.mfaRequired).toBe(true);
    await enableMfa(root);
    expect((await root.get('/admin/stats')).status).toBe(200);
    // Others still just get "forbidden".
    const user = await registeredClient(ctx, 'u@example.org', 'U');
    expect((await user.get('/admin/stats')).body.error.code).toBe('FORBIDDEN');
  });
});

describe('Google sign-in', () => {
  it('creates an account for a new Google user and signs them in', async () => {
    const client = await new TestClient(ctx).init();
    const start = await client.agent.get('/api/v1/auth/google/start?next=%2Fmembers');
    expect(start.headers['location']).toMatch(/^https:\/\/accounts\.google\.test\/auth\?state=/);
    const flowCookie = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('fh_google='))!;
    expect(flowCookie).toMatch(/HttpOnly/i);
    expect(flowCookie).toMatch(/SameSite=Lax/i);
    expect(flowCookie).toMatch(/Path=\/api\/v1\/auth\/google/);
    const state = new URL(start.headers['location'] as string).searchParams.get('state')!;

    const back = client.track(await client.agent.get(`/api/v1/auth/google/callback?state=${state}&code=${state}`));
    expect(back.status).toBe(302);
    expect(back.headers['location']).toBe('http://localhost:4200/members');
    await client.init();
    const me = (await client.get('/auth/me')).body.data.user;
    expect(me).toMatchObject({ email: 'esi@gmail.com', displayName: 'Esi Mensah', emailVerified: true, security: { hasPassword: false, mfaEnabled: false, google: { email: 'esi@gmail.com' } } });
    // The same Google account signs in to the same account; a password does not.
    const again = await new TestClient(ctx).init();
    expect((await viaGoogle(again)).headers['location']).toBe('http://localhost:4200/dashboard');
    expect(await UserModel.countDocuments()).toBe(1);
    expect((await again.post('/auth/login', { email: 'esi@gmail.com', password: 'anything at all' })).body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a callback without the matching flow', async () => {
    const client = await new TestClient(ctx).init();
    const start = await client.agent.get('/api/v1/auth/google/start');
    const state = new URL(start.headers['location'] as string).searchParams.get('state')!;
    expect((await client.agent.get(`/api/v1/auth/google/callback?state=${state}x&code=${state}`)).headers['location']).toBe('http://localhost:4200/auth/login?google=expired');
    const stranger = await new TestClient(ctx).init();
    expect((await stranger.agent.get(`/api/v1/auth/google/callback?state=${state}&code=${state}`)).headers['location']).toBe('http://localhost:4200/auth/login?google=expired');
    const cancelled = await new TestClient(ctx).init();
    const s2 = new URL((await cancelled.agent.get('/api/v1/auth/google/start')).headers['location'] as string).searchParams.get('state')!;
    expect((await cancelled.agent.get(`/api/v1/auth/google/callback?state=${s2}&error=access_denied`)).headers['location']).toBe('http://localhost:4200/auth/login?google=cancelled');
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('links to an existing account only when both sides vouch for the address', async () => {
    // Unconfirmed address here: no automatic link (someone may have registered another person's address).
    await registeredClient(ctx, 'esi@gmail.com', 'Esi');
    const first = await new TestClient(ctx).init();
    expect((await viaGoogle(first)).headers['location']).toBe('http://localhost:4200/auth/login?google=link_needed');
    // Confirmed address, and Google vouches for Gmail addresses: linked and signed in.
    await UserModel.updateOne({ email: 'esi@gmail.com' }, { emailVerifiedAt: new Date() });
    const second = await new TestClient(ctx).init();
    expect((await viaGoogle(second)).headers['location']).toBe('http://localhost:4200/dashboard');
    expect((await UserModel.findOne({ email: 'esi@gmail.com' }))!.google!.sub).toBe('g-1');
    await waitForMail('esi@gmail.com', /Google account can now sign in/);

    // An address Google does not manage is not trusted for linking.
    await registeredClient(ctx, 'kofi@example.org', 'Kofi');
    await UserModel.updateOne({ email: 'kofi@example.org' }, { emailVerifiedAt: new Date() });
    google.profile = { sub: 'g-2', email: 'kofi@example.org', emailVerified: true, name: 'Kofi', hostedDomain: null };
    expect((await viaGoogle(await new TestClient(ctx).init())).headers['location']).toBe('http://localhost:4200/auth/login?google=link_needed');
    google.profile = { ...google.profile, hostedDomain: 'example.org' };
    expect((await viaGoogle(await new TestClient(ctx).init())).headers['location']).toBe('http://localhost:4200/dashboard');
  });

  it('links from Settings, refuses a Google account used by someone else, and unlinks', async () => {
    const ama = await registeredClient(ctx, 'ama@example.org', 'Ama');
    google.profile = { sub: 'g-ama', email: 'ama.mensah@gmail.com', emailVerified: true, name: 'Ama', hostedDomain: null };
    expect((await viaGoogle(ama, '?mode=link')).headers['location']).toBe('http://localhost:4200/settings?google=linked');
    expect((await ama.get('/auth/me')).body.data.user.security.google).toEqual({ email: 'ama.mensah@gmail.com' });
    // Without signing in, linking starts at the sign-in page.
    expect((await (await new TestClient(ctx).init()).agent.get('/api/v1/auth/google/start?mode=link')).headers['location']).toBe('http://localhost:4200/auth/login?returnUrl=%2Fsettings');

    const kofi = await registeredClient(ctx, 'kofi@example.org', 'Kofi');
    expect((await viaGoogle(kofi, '?mode=link')).headers['location']).toBe('http://localhost:4200/settings?google=in_use');

    expect((await ama.delete('/auth/google')).status).toBe(204);
    expect((await ama.get('/auth/me')).body.data.user.security.google).toBeNull();
    expect((await ama.delete('/auth/google')).status).toBe(409);
  });

  it('accounts made with Google set a password before unlinking, and can be deleted after a recent sign-in', async () => {
    const esi = await new TestClient(ctx).init();
    await viaGoogle(esi);
    await esi.init();
    expect((await esi.delete('/auth/google')).status).toBe(409);
    expect((await esi.post('/auth/change-password', { newPassword: 'a brand new long password' })).status).toBe(204);
    expect((await esi.get('/auth/me')).body.data.user.security.hasPassword).toBe(true);
    // Now the current password is needed.
    expect((await esi.post('/auth/change-password', { newPassword: 'another long password here' })).status).toBe(400);
    expect((await esi.delete('/auth/google')).status).toBe(204);

    google.profile = { sub: 'g-3', email: 'yaw@gmail.com', emailVerified: true, name: 'Yaw', hostedDomain: null };
    const yaw = await new TestClient(ctx).init();
    await viaGoogle(yaw);
    await yaw.init();
    expect((await yaw.post('/account/delete', {})).status).toBe(204);
    expect((await UserModel.findOne({ 'google.sub': 'g-3' }))).toBeNull();
  });

  it('still asks for the code when two-step sign-in is on', async () => {
    const ama = await registeredClient(ctx, 'ama@example.org', 'Ama');
    const { next } = await enableMfa(ama);
    google.profile = { sub: 'g-ama', email: 'ama.mensah@gmail.com', emailVerified: true, name: 'Ama', hostedDomain: null };
    await viaGoogle(ama, '?mode=link');

    const phone = await new TestClient(ctx).init();
    const back = await viaGoogle(phone, '?next=%2Fcalendar');
    const location = new URL(back.headers['location'] as string);
    expect(location.pathname).toBe('/auth/two-step');
    expect(back.headers['set-cookie']?.toString() ?? '').not.toContain('fh_access=ey');
    const params = new URLSearchParams(location.hash.slice(1));
    expect(params.get('next')).toBe('/calendar');
    await phone.init();
    expect((await phone.get('/auth/me')).status).toBe(401);
    expect((await phone.post('/auth/login/mfa', { challenge: params.get('challenge'), code: next() })).status).toBe(200);
  });

  it('is off without a client, and says so', async () => {
    const plain = buildApp();
    try {
      const client = await new TestClient(plain).init();
      expect((await client.get('/config')).body.data.google).toBe(false);
      expect((await client.agent.get('/api/v1/auth/google/start')).headers['location']).toBe('http://localhost:4200/auth/login?google=unavailable');
    } finally {
      await plain.instance.close();
    }
  });
});
