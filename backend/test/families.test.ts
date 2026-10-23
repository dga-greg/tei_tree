import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { FamilyMemberModel } from '../src/modules/members/member.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, type TestContext } from './helpers.js';

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

const mensah = {
  name: 'Mensah Family',
  description: 'Descendants of Kofi Mensah',
  origin: { hometown: 'Kumasi', region: 'Ashanti', country: 'Ghana' },
  founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased', birthDate: { year: 1890, qualifier: 'about' } },
};

describe('family registration', () => {
  it('creates the family, makes the creator its administrator and the founder Generation 1', async () => {
    const kofi = await registeredClient(ctx, 'ama@example.org');
    const res = await kofi.post('/families', mensah);
    expect(res.status).toBe(201);
    const family = res.body.data;
    expect(family).toMatchObject({
      name: 'Mensah Family',
      slug: 'mensah-family',
      viewerRole: 'family_admin',
      origin: { hometown: 'Kumasi', region: 'Ashanti', country: 'Ghana' },
      privacy: { visibility: 'private', showLivingToMembers: true },
      generationPolicy: { countAdoptive: true },
      stats: { memberCount: 1, generationCount: 1, deceasedCount: 1 },
    });
    expect(family.foundingMemberId).toBeTruthy();

    const founder = await kofi.get(`/families/${family.id}/members/${family.foundingMemberId}`);
    expect(founder.body.data).toMatchObject({ displayName: 'Kofi Mensah', isFounder: true, generation: { number: 1, status: 'founder' } });

    const mine = await kofi.get('/families');
    expect(mine.body.data).toEqual([expect.objectContaining({ name: 'Mensah Family', role: 'family_admin' })]);
    expect(await AuditLogModel.countDocuments({ action: { $in: ['family.create', 'member.create', 'family.set_founder'] } })).toBe(3);
  });

  it('gives each family a unique slug and allows a family without a founder yet', async () => {
    const a = await registeredClient(ctx, 'a@example.org');
    const first = await a.post('/families', { name: 'Mensah Family' });
    const second = await a.post('/families', { name: 'Mensah  Family' });
    expect(first.body.data.slug).toBe('mensah-family');
    expect(second.body.data.slug).toMatch(/^mensah-family-[a-z0-9]+$/);
    expect(second.body.data.foundingMemberId).toBeNull();
  });

  it('rolls back everything when the founder is invalid', async () => {
    const a = await registeredClient(ctx, 'a@example.org');
    const res = await a.post('/families', { ...mensah, founder: { firstName: 'Kofi', vitalStatus: 'living', deathDate: { year: 1950 } } });
    expect(res.status).toBe(400);
    expect((await a.get('/families')).body.data).toEqual([]);
    expect(await FamilyMembershipModel.countDocuments()).toBe(0);
  });

  it('requires authentication to register a family', async () => {
    const res = await request(ctx.instance.app).post('/api/v1/families').send(mensah);
    expect(res.status).toBe(403); // CSRF check precedes authentication
  });
});

describe('family settings', () => {
  it('lets the administrator update details with optimistic concurrency', async () => {
    const admin = await registeredClient(ctx, 'admin@example.org');
    const family = (await admin.post('/families', mensah)).body.data;

    const ok = await admin.patch(`/families/${family.id}`, { version: family.version, description: 'Updated', privacy: { visibility: 'public' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ description: 'Updated', privacy: { visibility: 'public' } });

    const stale = await admin.patch(`/families/${family.id}`, { version: family.version, name: 'Stale edit' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('forbids ordinary members from changing settings', async () => {
    const admin = await registeredClient(ctx, 'admin@example.org');
    const family = (await admin.post('/families', mensah)).body.data;
    const member = await registeredClient(ctx, 'member@example.org');
    await FamilyMembershipModel.create({ familyId: family.id, userId: (await UserModel.findOne({ email: 'member@example.org' }))!._id, role: 'family_member' });
    const res = await member.patch(`/families/${family.id}`, { version: family.version, name: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('changes the founding ancestor to a newly discovered ancestor', async () => {
    const admin = await registeredClient(ctx, 'admin@example.org');
    const family = (await admin.post('/families', mensah)).body.data;
    const kofi = family.foundingMemberId;
    const elder = await addPerson(admin, family.id, { firstName: 'Nana', surname: 'Mensah', vitalStatus: 'deceased' }, { children: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });

    const res = await admin.put(`/families/${family.id}/founder`, { memberId: elder, reason: 'Found baptism record of Kofi naming his father' });
    expect(res.status).toBe(200);
    expect(res.body.data.foundingMemberId).toBe(elder);

    const [newFounder, oldFounder] = await Promise.all([FamilyMemberModel.findById(elder), FamilyMemberModel.findById(kofi)]);
    expect(newFounder!.generation).toMatchObject({ number: 1, status: 'founder' });
    // Kofi is now the founder's verified child.
    expect(oldFounder!.generation).toMatchObject({ number: 2, status: 'computed' });
    const audit = await AuditLogModel.findOne({ action: 'family.set_founder', 'after.reason': { $exists: true } }).sort({ at: -1 });
    expect(audit!.after).toMatchObject({ reason: 'Found baptism record of Kofi naming his father' });
  });

  it('rejects a founder from another family', async () => {
    const admin = await registeredClient(ctx, 'admin@example.org');
    const one = (await admin.post('/families', mensah)).body.data;
    const two = (await admin.post('/families', { ...mensah, name: 'Asante Family' })).body.data;
    const res = await admin.put(`/families/${one.id}/founder`, { memberId: two.foundingMemberId });
    expect(res.status).toBe(400);
  });
});

describe('platform administration of families', () => {
  it('lists registration metadata only and can suspend a family', async () => {
    const owner = await registeredClient(ctx, 'owner@example.org');
    const family = (await owner.post('/families', mensah)).body.data;
    const root = await registeredClient(ctx, 'root@example.org');
    await UserModel.updateOne({ email: 'root@example.org' }, { platformRole: 'super_admin' });

    const list = await root.get('/admin/families');
    expect(list.body.data).toEqual([
      expect.objectContaining({ name: 'Mensah Family', memberCount: 1, accountCount: 1, createdBy: expect.objectContaining({ email: 'owner@example.org' }) }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain('Kofi');

    expect((await root.patch(`/admin/families/${family.id}`, { status: 'suspended' })).status).toBe(204);
    expect((await root.get(`/families/${family.id}/members`)).status).toBe(404);
  });
});
