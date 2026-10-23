import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Response } from 'supertest';
import { inject } from 'vitest';
import { createApp, type AppDependencies, type AppInstance } from '../src/app.js';
import { loadEnv, type Env } from '../src/config/env.js';
import { createLogger } from '../src/core/logger.js';
import { MemoryMailer } from '../src/infra/mailer.js';
import { syncIndexes } from '../src/infra/mongo.js';
import { MemoryPushSender } from '../src/infra/push.js';

export const TEST_PASSWORD = 'correct horse battery staple';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:4200',
    MONGODB_URI: 'mongodb://unused',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-32-chars',
    CSRF_SECRET: 'test-csrf-secret-that-is-at-least-32-characters',
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_TIME_COST: '1',
    LOG_LEVEL: 'silent',
    RATE_LIMIT_AUTH_PER_15_MINUTES: '1000',
    RATE_LIMIT_GLOBAL_PER_MINUTE: '10000',
    ADMIN_MFA_REQUIRED: 'false',
    MEDIA_LOCAL_DIR: path.join(os.tmpdir(), `fh-media-${randomUUID().slice(0, 8)}`),
    ...overrides,
  });
}

/** Connects mongoose to a fresh database for the current test file. */
export async function connectTestDb(): Promise<void> {
  const uri = new URL(inject('mongoUri'));
  uri.pathname = `/fh_test_${randomUUID().slice(0, 8)}`;
  await mongoose.connect(uri.toString());
  await syncIndexes(createLogger('silent', false));
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export async function clearDb(): Promise<void> {
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export interface TestContext {
  instance: AppInstance;
  mailer: MemoryMailer;
  push: MemoryPushSender;
  env: Env;
}

export function buildApp(overrides: Record<string, string> = {}, deps: Partial<AppDependencies> = {}): TestContext {
  const env = testEnv(overrides);
  const mailer = new MemoryMailer();
  const push = new MemoryPushSender();
  const instance = createApp({ env, logger: createLogger('silent', false), mailer, push, ...deps });
  return { instance, mailer, push, env };
}

function cookieValue(res: Response, name: string): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  let value: string | undefined;
  // Like a browser, the last Set-Cookie for a name wins.
  for (const c of header ?? []) {
    const [pair] = c.split(';');
    const idx = pair!.indexOf('=');
    if (pair!.slice(0, idx) === name) value = decodeURIComponent(pair!.slice(idx + 1));
  }
  return value;
}

/**
 * A browser-like client: keeps cookies between requests and echoes the CSRF cookie in the
 * X-XSRF-TOKEN header, exactly as Angular's HttpClient does.
 */
export class TestClient {
  readonly agent;
  private csrf = '';

  constructor(ctx: TestContext) {
    this.agent = request.agent(ctx.instance.app);
  }

  /** Picks up the CSRF token from any response (also ones fetched through `agent` directly). */
  track(res: Response): Response {
    const token = cookieValue(res, 'XSRF-TOKEN');
    if (token) this.csrf = token;
    return res;
  }

  async init(): Promise<this> {
    this.track(await this.agent.get('/api/v1/auth/csrf'));
    return this;
  }

  async get(path: string) {
    return this.track(await this.agent.get(`/api/v1${path}`));
  }

  async post(path: string, body?: object) {
    return this.track(await this.agent.post(`/api/v1${path}`).set('X-XSRF-TOKEN', this.csrf).send(body ?? {}));
  }

  async patch(path: string, body: object) {
    return this.track(await this.agent.patch(`/api/v1${path}`).set('X-XSRF-TOKEN', this.csrf).send(body));
  }

  async put(path: string, body: object) {
    return this.track(await this.agent.put(`/api/v1${path}`).set('X-XSRF-TOKEN', this.csrf).send(body));
  }

  async delete(path: string) {
    return this.track(await this.agent.delete(`/api/v1${path}`).set('X-XSRF-TOKEN', this.csrf));
  }

  /** Multipart upload, as the browser's FormData would send it. */
  async upload(path: string, file: { buffer: Buffer; name: string; type?: string }, fields: Record<string, unknown> = {}) {
    let req = this.agent.post(`/api/v1${path}`).set('X-XSRF-TOKEN', this.csrf);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, typeof v === 'string' ? v : JSON.stringify(v));
    return this.track(await req.attach('file', file.buffer, { filename: file.name, contentType: file.type ?? 'application/octet-stream' }));
  }

  static refreshCookie(res: Response): string | undefined {
    return cookieValue(res, 'fh_refresh');
  }
}

export async function registeredClient(ctx: TestContext, email: string, displayName = 'Test User'): Promise<TestClient> {
  const client = await new TestClient(ctx).init();
  const res = await client.post('/auth/register', { email, password: TEST_PASSWORD, displayName });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return client;
}

/** Shorthand for creating people through the API in genealogy tests. */
export async function addPerson(
  client: TestClient,
  familyId: string,
  person: Record<string, unknown>,
  links?: Record<string, unknown>,
): Promise<string> {
  const res = await client.post(`/families/${familyId}/members`, { person, ...(links ? { links } : {}) });
  if (res.status !== 201) throw new Error(`addPerson failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

export async function link(client: TestClient, familyId: string, body: Record<string, unknown>) {
  return client.post(`/families/${familyId}/relationships`, { verification: 'verified', ...body });
}
