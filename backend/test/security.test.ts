import { readFileSync } from 'node:fs';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPerson, buildApp, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

/**
 * Sweeps every family route (read from the route file, so new routes are covered automatically):
 * - outsiders and anonymous visitors never learn that a private family exists (always 404);
 * - malformed ids and empty bodies never cause a server error.
 */
const source = readFileSync(new URL('../src/modules/families/families.routes.ts', import.meta.url), 'utf8');
const ROUTES = [...source.matchAll(/family\.(get|post|patch|put|delete)\('([^']+)'/g)].map((m) => ({ method: m[1] as 'get' | 'post' | 'patch' | 'put' | 'delete', path: m[2]! }));

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let kwame: string;

beforeAll(async () => {
  await connectTestDb();
  ctx = buildApp();
  admin = await registeredClient(ctx, 'admin@example.org', 'Admin');
  const fam = (await admin.post('/families', { name: 'Private Family', founder: { firstName: 'Kofi', surname: 'Mensah' } })).body.data;
  familyId = fam.id;
  kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah' });
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});

function fill(path: string, id: string): string {
  return path.replace(/:[A-Za-z]+/g, id);
}

async function call(client: TestClient, method: string, path: string) {
  switch (method) {
    case 'get':
      return client.get(path);
    case 'post':
      return client.post(path, {});
    case 'patch':
      return client.patch(path, {});
    case 'put':
      return client.put(path, {});
    default:
      return client.delete(path);
  }
}

describe('route sweep', () => {
  it('finds the family routes', () => {
    expect(ROUTES.length).toBeGreaterThan(15);
  });

  it('hides a private family from outsiders and anonymous visitors on every route', async () => {
    const outsider = await registeredClient(ctx, 'outsider@example.org', 'Outsider');
    const anonymous = await new TestClient(ctx).init();
    const leaks: string[] = [];
    for (const r of ROUTES) {
      const path = `/families/${familyId}${fill(r.path === '/' ? '' : r.path, kwame)}`;
      for (const [who, client] of [['outsider', outsider], ['anonymous', anonymous]] as const) {
        const res = await call(client, r.method, path);
        if (res.status !== 404) leaks.push(`${who} ${r.method.toUpperCase()} ${r.path} → ${res.status}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('never answers malformed ids or empty bodies with a server error', async () => {
    const errors: string[] = [];
    for (const id of ['not-an-id', new Types.ObjectId().toString(), '{"$gt":""}']) {
      for (const r of ROUTES) {
        if (r.path === '/deletion') continue; // would schedule deletion of the test family if it succeeded
        const res = await call(admin, r.method, `/families/${familyId}${fill(r.path === '/' ? '' : r.path, encodeURIComponent(id))}`);
        if (res.status >= 500) errors.push(`${r.method.toUpperCase()} ${r.path} (${id}) → ${res.status}`);
      }
    }
    expect(errors).toEqual([]);
  });

  it('cannot be fed query operators through the URL', async () => {
    // Express 5's simple parser never builds objects from `a[$ne]=x`, so operators cannot reach MongoDB…
    expect(ctx.instance.app.get('query parser')).toBe('simple');
    // …and repeated parameters (arrays) are refused by validation instead of being passed on.
    expect((await admin.get(`/families/${familyId}/members?hometown=a&hometown=b`)).status).toBe(400);
    // Search text is matched literally, not as a regular expression.
    const search = await admin.get(`/families/${familyId}/members/search?q=${encodeURIComponent('.*')}`);
    expect(search.status).toBe(200);
    expect(search.body.data).toEqual([]);
  });

  it('does not accept unknown fields (no mass assignment)', async () => {
    const person = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data;
    const res = await admin.patch(`/families/${familyId}/members/${kwame}`, { version: person.version, familyId: new Types.ObjectId().toString(), 'generation.number': 1 });
    expect(res.status).toBe(400);
    expect((await admin.patch('/auth/me', { platformRole: 'super_admin' })).status).toBe(400);
  });

  it('sends security headers on API responses', async () => {
    const res = await admin.get('/auth/me');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
