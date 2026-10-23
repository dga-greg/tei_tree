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

describe('when Redis is down', () => {
  it('still answers requests instead of waiting for it', async () => {
    const { createRedis } = await import('../src/infra/redis.js');
    const { createLogger } = await import('../src/core/logger.js');
    // Nothing listens on this port.
    const redis = createRedis('redis://127.0.0.1:6399', createLogger('silent', false));
    const down = buildApp({}, { redis });
    try {
      const started = Date.now();
      const res = await new TestClient(down).get('/auth/csrf');
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(8000);
    } finally {
      redis.disconnect();
    }
  }, 20_000);
});
