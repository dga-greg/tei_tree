import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, connectTestDb, disconnectTestDb, TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  await connectTestDb();
  ctx = buildApp({ RATE_LIMIT_AUTH_PER_15_MINUTES: '3' });
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});

describe('credential endpoint rate limiting', () => {
  it('blocks a client after the configured number of attempts', async () => {
    const client = await new TestClient(ctx).init();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await client.post('/auth/login', { email: 'a@example.org', password: 'wrong password here' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const blocked = await client.post('/auth/forgot-password', { email: 'a@example.org' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
