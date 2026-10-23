import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AuthSessionModel } from '../src/modules/auth/session.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import {
  buildApp,
  clearDb,
  connectTestDb,
  disconnectTestDb,
  registeredClient,
  TEST_PASSWORD,
  TestClient,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  await connectTestDb();
  ctx = buildApp({ LOGIN_MAX_ATTEMPTS: '3' });
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  ctx.mailer.outbox.length = 0;
});

/** A request carrying only the given cookies plus a valid CSRF pair, as an attacker replaying a token would. */
async function rawPost(path: string, cookies: string) {
  const csrf = await request(ctx.instance.app).get('/api/v1/auth/csrf');
  const token = csrf.body.data.token as string;
  return request(ctx.instance.app)
    .post(`/api/v1${path}`)
    .set('Cookie', `XSRF-TOKEN=${token}; ${cookies}`)
    .set('X-XSRF-TOKEN', token)
    .send({});
}

describe('registration', () => {
  it('creates an account, starts a session and never returns the password hash', async () => {
    const client = await new TestClient(ctx).init();
    const res = await client.post('/auth/register', {
      email: '  Kofi.Mensah@Example.org ',
      password: TEST_PASSWORD,
      displayName: 'Kofi Mensah',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: 'kofi.mensah@example.org', displayName: 'Kofi Mensah', platformRole: 'user' });
    expect(JSON.stringify(res.body)).not.toContain('argon2');

    const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toMatch(/fh_access=.*HttpOnly.*SameSite=Strict/);
    expect(cookies).toMatch(/fh_refresh=.*Path=\/api\/v1\/auth.*HttpOnly/);

    const me = await client.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('kofi.mensah@example.org');

    const stored = await UserModel.findOne({ email: 'kofi.mensah@example.org' }).select('+passwordHash');
    expect(stored!.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects a duplicate e-mail address', async () => {
    await registeredClient(ctx, 'ama@example.org');
    const client = await new TestClient(ctx).init();
    const res = await client.post('/auth/register', { email: 'AMA@example.org', password: TEST_PASSWORD, displayName: 'Ama' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input and reports field paths', async () => {
    const client = await new TestClient(ctx).init();
    const res = await client.post('/auth/register', { email: 'not-an-email', password: 'short', displayName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const paths = res.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(['displayName', 'email', 'password']);
  });

  it('rejects unknown fields such as an attempt to self-assign a role', async () => {
    const client = await new TestClient(ctx).init();
    const res = await client.post('/auth/register', {
      email: 'yaw@example.org',
      password: TEST_PASSWORD,
      displayName: 'Yaw',
      platformRole: 'super_admin',
    });
    expect(res.status).toBe(400);
    expect(await UserModel.countDocuments()).toBe(0);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without a matching signed token', async () => {
    const agent = request.agent(ctx.instance.app);
    const noToken = await agent.post('/api/v1/auth/login').send({ email: 'a@b.org', password: 'x' });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');

    // An attacker-chosen cookie/header pair without a valid signature is rejected.
    const forged = await request(ctx.instance.app)
      .post('/api/v1/auth/login')
      .set('Cookie', 'XSRF-TOKEN=abc.def')
      .set('X-XSRF-TOKEN', 'abc.def')
      .send({ email: 'a@b.org', password: 'x' });
    expect(forged.status).toBe(403);
  });

  it('accepts requests that echo the issued token', async () => {
    const client = await new TestClient(ctx).init();
    const res = await client.post('/auth/login', { email: 'nobody@example.org', password: 'whatever-password' });
    expect(res.status).toBe(401);
  });
});

describe('login', () => {
  it('gives the same answer for an unknown e-mail and a wrong password', async () => {
    await registeredClient(ctx, 'esi@example.org');
    const client = await new TestClient(ctx).init();
    const wrong = await client.post('/auth/login', { email: 'esi@example.org', password: 'wrong password here' });
    const unknown = await client.post('/auth/login', { email: 'ghost@example.org', password: 'wrong password here' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('signs in with the right password', async () => {
    await registeredClient(ctx, 'esi@example.org');
    const client = await new TestClient(ctx).init();
    const res = await client.post('/auth/login', { email: 'ESI@example.org', password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect((await client.get('/auth/me')).status).toBe(200);
  });

  it('locks the account temporarily after repeated failures', async () => {
    await registeredClient(ctx, 'kwame@example.org');
    const client = await new TestClient(ctx).init();
    for (let i = 0; i < 3; i++) {
      await client.post('/auth/login', { email: 'kwame@example.org', password: 'wrong password here' });
    }
    const locked = await client.post('/auth/login', { email: 'kwame@example.org', password: TEST_PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('refuses suspended accounts only after the password is proven', async () => {
    await registeredClient(ctx, 'abena@example.org');
    await UserModel.updateOne({ email: 'abena@example.org' }, { status: 'suspended' });
    const client = await new TestClient(ctx).init();
    const wrong = await client.post('/auth/login', { email: 'abena@example.org', password: 'wrong password here' });
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const right = await client.post('/auth/login', { email: 'abena@example.org', password: TEST_PASSWORD });
    expect(right.status).toBe(403);
    expect(right.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('sessions', () => {
  it('requires authentication for /auth/me', async () => {
    const client = await new TestClient(ctx).init();
    const res = await client.get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('reports an expired access token as SESSION_EXPIRED so the client can refresh', async () => {
    const client = await registeredClient(ctx, 'kojo@example.org');
    const user = await UserModel.findOne({ email: 'kojo@example.org' });
    const session = await AuthSessionModel.findOne({ userId: user!._id });
    const expired = jwt.sign({ sid: session!.id, exp: Math.floor(Date.now() / 1000) - 10 }, ctx.env.JWT_ACCESS_SECRET, {
      subject: user!.id,
      issuer: 'family-heritage',
      audience: 'family-heritage-api',
    });
    const res = await request(ctx.instance.app).get('/api/v1/auth/me').set('Cookie', `fh_access=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');

    const refreshed = await client.post('/auth/refresh');
    expect(refreshed.status).toBe(200);
  });

  it('rejects access tokens signed with another key', async () => {
    const forged = jwt.sign({ sid: '0'.repeat(24) }, 'another-secret-another-secret-another-secret', {
      subject: '0'.repeat(24),
      issuer: 'family-heritage',
      audience: 'family-heritage-api',
    });
    const res = await request(ctx.instance.app).get('/api/v1/auth/me').set('Cookie', `fh_access=${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rotates the refresh token, tolerates concurrent tabs and revokes the session on replay', async () => {
    const client = await new TestClient(ctx).init();
    const reg = await client.post('/auth/register', { email: 'adwoa@example.org', password: TEST_PASSWORD, displayName: 'Adwoa' });
    const originalToken = TestClient.refreshCookie(reg)!;
    expect(originalToken).toBeDefined();

    const rotated = await client.post('/auth/refresh');
    expect(rotated.status).toBe(200);
    const newToken = TestClient.refreshCookie(rotated);
    expect(newToken).toBeDefined();
    expect(newToken).not.toBe(originalToken);

    // Another tab presenting the just-rotated token within the grace window gets an access token
    // but no new refresh token (the browser already holds the newest one).
    const concurrent = await rawPost('/auth/refresh', `fh_refresh=${originalToken}`);
    expect(concurrent.status).toBe(200);
    expect(TestClient.refreshCookie(concurrent)).toBeUndefined();

    // Replaying the old token after the grace window means it was stolen: revoke the session.
    await AuthSessionModel.updateOne({}, { $set: { 'previousTokens.0.rotatedAt': new Date(Date.now() - 60_000) } });
    const replay = await rawPost('/auth/refresh', `fh_refresh=${originalToken}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_EXPIRED');
    const session = await AuthSessionModel.findOne();
    expect(session!.revokedReason).toBe('refresh_token_reuse');

    // The legitimate holder is signed out too.
    expect((await client.post('/auth/refresh')).status).toBe(401);
    expect((await client.get('/auth/me')).status).toBe(401);
  });

  it('signs out a session left idle, unless the person chose to stay signed in', async () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    const client = await registeredClient(ctx, 'idle@example.org');
    expect((await client.get('/auth/me')).body.data.user.session).toEqual({ idleTimeoutMinutes: 30 });

    // Activity reported by the app keeps the session going.
    await AuthSessionModel.updateOne({}, { $set: { lastActiveAt: minutesAgo(20) } });
    expect((await client.post('/auth/activity')).status).toBe(204);
    expect((await AuthSessionModel.findOne())!.lastActiveAt!.getTime()).toBeGreaterThan(Date.now() - 5000);
    expect((await client.post('/auth/refresh')).status).toBe(200);
    // Refreshing is not activity: background requests must not keep a forgotten session alive.
    await AuthSessionModel.updateOne({}, { $set: { lastActiveAt: minutesAgo(25) } });
    expect((await client.post('/auth/refresh')).status).toBe(200);
    expect((await AuthSessionModel.findOne())!.lastActiveAt!.getTime()).toBeLessThan(Date.now() - 24 * 60_000);

    await AuthSessionModel.updateOne({}, { $set: { lastActiveAt: minutesAgo(31) } });
    const late = await client.post('/auth/refresh');
    expect(late.status).toBe(401);
    expect(late.body.error.message).toMatch(/inactivity/);
    expect((await AuthSessionModel.findOne())!.revokedReason).toBe('idle');
    expect((await client.get('/auth/me')).status).toBe(401);

    // Activity reported too late does not bring it back either.
    const other = await new TestClient(ctx).init();
    await other.post('/auth/login', { email: 'idle@example.org', password: TEST_PASSWORD });
    await AuthSessionModel.updateOne({ revokedAt: null }, { $set: { lastActiveAt: minutesAgo(45) } });
    expect((await other.post('/auth/activity')).status).toBe(401);

    // "Keep me signed in on this device".
    const kept = await new TestClient(ctx).init();
    const login = await kept.post('/auth/login', { email: 'idle@example.org', password: TEST_PASSWORD, remember: true });
    expect(login.body.data.user.session).toEqual({ idleTimeoutMinutes: null });
    await AuthSessionModel.updateOne({ revokedAt: null }, { $set: { lastActiveAt: minutesAgo(600) } });
    expect((await kept.post('/auth/refresh')).status).toBe(200);
  });

  it('logout revokes the session and clears cookies', async () => {
    const client = await registeredClient(ctx, 'efua@example.org');
    const res = await client.post('/auth/logout');
    expect(res.status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401);
    expect((await client.post('/auth/refresh')).status).toBe(401);
    const session = await AuthSessionModel.findOne();
    expect(session!.revokedReason).toBe('logout');
  });

  it('lists and revokes own sessions', async () => {
    const laptop = await registeredClient(ctx, 'akua@example.org');
    const phone = await new TestClient(ctx).init();
    await phone.post('/auth/login', { email: 'akua@example.org', password: TEST_PASSWORD });

    const list = await laptop.get('/auth/sessions');
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((s: { current: boolean }) => !s.current);
    expect((await laptop.delete(`/auth/sessions/${other.id}`)).status).toBe(204);
    expect((await phone.get('/auth/me')).status).toBe(401);
    expect((await laptop.get('/auth/me')).status).toBe(200);
  });
});

describe('password recovery', () => {
  it('does not reveal whether an account exists', async () => {
    const client = await new TestClient(ctx).init();
    const res = await client.post('/auth/forgot-password', { email: 'ghost@example.org' });
    expect(res.status).toBe(202);
    expect(ctx.mailer.outbox).toHaveLength(0);
  });

  it('resets the password with a single-use token and signs out every session', async () => {
    const oldDevice = await registeredClient(ctx, 'yaa@example.org');
    const client = await new TestClient(ctx).init();
    expect((await client.post('/auth/forgot-password', { email: 'yaa@example.org' })).status).toBe(202);

    const resets = ctx.mailer.outbox.filter((m) => m.subject.startsWith('Reset'));
    expect(resets).toHaveLength(1);
    const token = /token=([A-Za-z0-9_-]+)/.exec(resets[0]!.text)![1]!;
    expect(resets[0]!.text).toContain('http://localhost:4200/auth/reset-password?token=');

    const newPassword = 'a brand new long passphrase';
    expect((await client.post('/auth/reset-password', { token, password: newPassword })).status).toBe(204);
    expect((await client.post('/auth/reset-password', { token, password: 'yet another passphrase' })).status).toBe(400);

    expect((await oldDevice.get('/auth/me')).status).toBe(401);
    expect((await client.post('/auth/login', { email: 'yaa@example.org', password: TEST_PASSWORD })).status).toBe(401);
    expect((await client.post('/auth/login', { email: 'yaa@example.org', password: newPassword })).status).toBe(200);
  });

  it('invalidates older reset links when a new one is requested', async () => {
    await registeredClient(ctx, 'ekow@example.org');
    const client = await new TestClient(ctx).init();
    await client.post('/auth/forgot-password', { email: 'ekow@example.org' });
    await client.post('/auth/forgot-password', { email: 'ekow@example.org' });
    const [first, second] = ctx.mailer.outbox.filter((m) => m.subject.startsWith('Reset')).map((m) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!);
    expect((await client.post('/auth/reset-password', { token: first!, password: 'a brand new long passphrase' })).status).toBe(400);
    expect((await client.post('/auth/reset-password', { token: second!, password: 'a brand new long passphrase' })).status).toBe(204);
  });
});

describe('e-mail verification', () => {
  it('sends a confirmation link on registration that confirms the address once', async () => {
    const client = await registeredClient(ctx, 'kwabena@example.org');
    expect((await client.get('/auth/me')).body.data.user.emailVerified).toBe(false);
    const mail = ctx.mailer.outbox.find((m) => m.subject.startsWith('Confirm'))!;
    expect(mail.to).toBe('kwabena@example.org');
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const res = await client.post('/auth/verify-email', { token });
    expect(res.status).toBe(200);
    expect(res.body.data.user.emailVerified).toBe(true);
    expect((await client.post('/auth/verify-email', { token })).status).toBe(400);
    expect((await client.post('/auth/resend-verification')).status).toBe(409);
  });

  it('replaces older links when a new one is requested', async () => {
    const client = await registeredClient(ctx, 'afia@example.org');
    expect((await client.post('/auth/resend-verification')).status).toBe(202);
    const [first, second] = ctx.mailer.outbox.filter((m) => m.subject.startsWith('Confirm')).map((m) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!);
    expect((await client.post('/auth/verify-email', { token: first! })).status).toBe(400);
    expect((await client.post('/auth/verify-email', { token: second! })).status).toBe(200);
  });
});

describe('account settings', () => {
  it('changes the password, keeping only the current session', async () => {
    const laptop = await registeredClient(ctx, 'nana@example.org');
    const phone = await new TestClient(ctx).init();
    await phone.post('/auth/login', { email: 'nana@example.org', password: TEST_PASSWORD });

    const wrong = await laptop.post('/auth/change-password', { currentPassword: 'not my password', newPassword: 'another long passphrase' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('currentPassword');

    const ok = await laptop.post('/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'another long passphrase' });
    expect(ok.status).toBe(204);
    expect((await laptop.get('/auth/me')).status).toBe(200);
    expect((await phone.get('/auth/me')).status).toBe(401);
    expect(ctx.mailer.outbox.at(-1)!.subject).toContain('password was changed');
  });

  it('updates the display name and preferences', async () => {
    const client = await registeredClient(ctx, 'fiifi@example.org');
    const res = await client.patch('/auth/me', { displayName: 'Fiifi A.', preferences: { theme: 'dark' } });
    expect(res.status).toBe(200);
    expect(res.body.data.user.displayName).toBe('Fiifi A.');
    expect(res.body.data.user.preferences.theme).toBe('dark');
  });

  it('remembers that the welcome tour was seen', async () => {
    const client = await registeredClient(ctx, 'esi@example.org');
    expect((await client.get('/auth/me')).body.data.user.preferences.tourSeen).toBe(false);
    const res = await client.patch('/auth/me', { preferences: { tourSeen: true } });
    expect(res.body.data.user.preferences.tourSeen).toBe(true);
    expect((await client.get('/auth/me')).body.data.user.preferences.tourSeen).toBe(true);
    expect((await client.patch('/auth/me', { preferences: { tourSeen: 'yes' } })).status).toBe(400);
  });
});
