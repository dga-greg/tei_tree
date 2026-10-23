import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { FamilyModel } from '../src/modules/families/family.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  await connectTestDb();
  ctx = buildApp();
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});
beforeEach(clearDb);

async function superAdmin(email = 'root@example.org'): Promise<TestClient> {
  const client = await registeredClient(ctx, email, 'Platform Admin');
  await UserModel.updateOne({ email }, { platformRole: 'super_admin' });
  return client;
}

async function userId(email: string): Promise<Types.ObjectId> {
  return (await UserModel.findOne({ email }))!._id;
}

async function createFamily(name: string, visibility: 'private' | 'unlisted' | 'public', admin?: Types.ObjectId) {
  const family = await FamilyModel.create({
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    description: `${name} description`,
    origin: { hometown: 'Kumasi', region: 'Ashanti', country: 'Ghana' },
    privacy: { visibility },
    stats: { memberCount: 12, livingCount: 5, deceasedCount: 7 },
    createdBy: admin ?? new Types.ObjectId(),
  });
  if (admin) await FamilyMembershipModel.create({ familyId: family._id, userId: admin, role: 'family_admin' });
  return family;
}

describe('platform administration', () => {
  it('requires authentication', async () => {
    const res = await request(ctx.instance.app).get('/api/v1/admin/users');
    expect(res.status).toBe(401);
  });

  it('is forbidden to ordinary users', async () => {
    const client = await registeredClient(ctx, 'member@example.org');
    for (const path of ['/admin/users', '/admin/stats']) {
      const res = await client.get(path);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('lists accounts with search and pagination', async () => {
    const admin = await superAdmin();
    for (const n of ['kofi', 'ama', 'yaw']) await registeredClient(ctx, `${n}@example.org`, n.toUpperCase());

    const all = await admin.get('/admin/users?pageSize=2');
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });

    const search = await admin.get('/admin/users?q=ama');
    expect(search.body.data.map((u: { email: string }) => u.email)).toEqual(['ama@example.org']);

    // Regex metacharacters are treated literally.
    expect((await admin.get('/admin/users?q=.*')).body.data).toHaveLength(0);
  });

  it('suspends an account, revokes its sessions and writes an audit entry', async () => {
    const admin = await superAdmin();
    const member = await registeredClient(ctx, 'kwesi@example.org');
    const target = await userId('kwesi@example.org');

    const res = await admin.patch(`/admin/users/${target}`, { status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('suspended');
    expect((await member.get('/auth/me')).status).toBe(401);

    const audit = await AuditLogModel.findOne({ action: 'admin.user.update' });
    expect(audit).toMatchObject({ familyId: null, actorRole: 'super_admin', targetType: 'user' });
    expect(audit!.before).toEqual({ status: 'active', platformRole: 'user' });
    expect(audit!.after).toEqual({ status: 'suspended', platformRole: 'user' });
  });

  it('does not let an administrator change their own account', async () => {
    const admin = await superAdmin();
    const res = await admin.patch(`/admin/users/${await userId('root@example.org')}`, { platformRole: 'user' });
    expect(res.status).toBe(403);
  });

  it('reports platform statistics without family content', async () => {
    const admin = await superAdmin();
    await createFamily('Mensah Family', 'private');
    const res = await admin.get('/admin/stats');
    expect(res.body.data).toEqual({ users: { total: 1, active: 1, suspended: 0 }, families: { total: 1, active: 1 } });
  });

  it('returns 404 for malformed and unknown ids', async () => {
    const admin = await superAdmin();
    expect((await admin.patch('/admin/users/not-an-id', { status: 'suspended' })).status).toBe(404);
    expect((await admin.patch(`/admin/users/${new Types.ObjectId()}`, { status: 'suspended' })).status).toBe(404);
  });
});

describe('family access isolation', () => {
  it('lists only the families the user belongs to, with their role', async () => {
    const kofi = await registeredClient(ctx, 'kofi@example.org');
    const kofiId = await userId('kofi@example.org');
    const mensah = await createFamily('Mensah Family', 'private', kofiId);
    const asante = await createFamily('Asante Family', 'private');
    await FamilyMembershipModel.create({ familyId: asante._id, userId: kofiId, role: 'family_member' });
    await createFamily('Boateng Family', 'public');

    const res = await kofi.get('/families');
    expect(res.status).toBe(200);
    expect(res.body.data.map((f: { name: string; role: string }) => [f.name, f.role])).toEqual([
      ['Asante Family', 'family_member'],
      ['Mensah Family', 'family_admin'],
    ]);
    expect(res.body.data[1].id).toBe(mensah.id);
  });

  it('hides private families from non-members, including super administrators', async () => {
    await registeredClient(ctx, 'owner@example.org');
    const family = await createFamily('Mensah Family', 'private', await userId('owner@example.org'));
    const outsider = await registeredClient(ctx, 'outsider@example.org');
    const admin = await superAdmin();

    for (const client of [outsider, admin]) {
      const res = await client.get(`/families/${family.id}`);
      expect(res.status).toBe(404);
    }
    expect((await request(ctx.instance.app).get(`/api/v1/families/${family.id}`)).status).toBe(404);
  });

  it('shows members the family with its settings and their role', async () => {
    const owner = await registeredClient(ctx, 'owner@example.org');
    const family = await createFamily('Mensah Family', 'private', await userId('owner@example.org'));
    const res = await owner.get(`/families/${family.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Mensah Family',
      viewerRole: 'family_admin',
      origin: { hometown: 'Kumasi', region: 'Ashanti', country: 'Ghana' },
      privacy: { visibility: 'private' },
      stats: { memberCount: 12, livingCount: 5, deceasedCount: 7 },
    });
  });

  it('shows guests only the public face of a public family', async () => {
    const family = await createFamily('Boateng Family', 'public');
    const res = await request(ctx.instance.app).get(`/api/v1/families/${family.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.viewerRole).toBe('guest');
    expect(res.body.data.privacy).toBeNull();
    expect(res.body.data.generationPolicy).toBeNull();
    expect(res.body.data.stats.livingCount).toBe(0);
    expect(res.body.data.stats.memberCount).toBe(12);
  });

  it('hides suspended families from non-members even when public', async () => {
    const family = await createFamily('Boateng Family', 'public');
    await FamilyModel.updateOne({ _id: family._id }, { status: 'suspended' });
    expect((await request(ctx.instance.app).get(`/api/v1/families/${family.id}`)).status).toBe(404);
  });

  it('does not treat a removed membership as access', async () => {
    const former = await registeredClient(ctx, 'former@example.org');
    const family = await createFamily('Mensah Family', 'private');
    await FamilyMembershipModel.create({ familyId: family._id, userId: await userId('former@example.org'), status: 'removed' });
    expect((await former.get(`/families/${family.id}`)).status).toBe(404);
    expect((await former.get('/families')).body.data).toEqual([]);
  });
});

describe('API conventions', () => {
  it('returns the error envelope with a request id for unknown endpoints', async () => {
    const res = await request(ctx.instance.app).get('/api/v1/nope').set('X-Request-Id', 'test-request-123');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBe('test-request-123');
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Endpoint not found', requestId: 'test-request-123' } });
  });

  it('reports malformed JSON as a validation error', async () => {
    const client = await new TestClient(ctx).init();
    const token = (await client.get('/auth/csrf')).body.data.token as string;
    const res = await client.agent
      .post('/api/v1/auth/login')
      .set('X-XSRF-TOKEN', token)
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('sets security headers and disables caching of API responses', async () => {
    const res = await request(ctx.instance.app).get('/api/v1/auth/csrf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
