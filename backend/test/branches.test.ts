import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, type TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
const ids = {} as Record<'kofi' | 'kwame' | 'ama' | 'yaw' | 'esi' | 'abena', string>;

beforeAll(async () => {
  await connectTestDb();
  ctx = buildApp();
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearDb();
  admin = await registeredClient(ctx, 'admin@example.org');
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased' } })).body.data;
  familyId = fam.id;
  ids.kofi = fam.foundingMemberId;
  const child = (firstName: string, parent: string, extra: Record<string, unknown> = {}) =>
    addPerson(admin, familyId, { firstName, surname: 'Mensah', ...extra }, { parents: [{ memberId: parent, subtype: 'biological', verification: 'verified' }] });
  ids.kwame = await child('Kwame', ids.kofi, { birthDate: { year: 1920 } });
  ids.ama = await child('Ama', ids.kofi, { birthDate: { year: 1925 } });
  ids.yaw = await child('Yaw', ids.kwame, { vitalStatus: 'living' });
  ids.esi = await child('Esi', ids.yaw, { vitalStatus: 'living' });
  ids.abena = await child('Abena', ids.ama);
});

async function joinAs(email: string, role: string, extra: Record<string, unknown> = {}): Promise<TestClient> {
  const client = await registeredClient(ctx, email);
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role, ...extra });
  return client;
}

describe('family branches', () => {
  it("creates a branch for each of the founder's children, with statistics", async () => {
    const res = await admin.post(`/families/${familyId}/branches/from-founder-children`);
    expect(res.status).toBe(201);
    const byName = Object.fromEntries(res.body.data.map((b: { name: string; stats: unknown }) => [b.name, b.stats]));
    expect(Object.keys(byName)).toEqual(['Ama Mensah branch', 'Kwame Mensah branch']);
    expect(byName['Kwame Mensah branch']).toMatchObject({ descendantCount: 2, generationSpan: 3, livingCount: 2 });
    expect(byName['Ama Mensah branch']).toMatchObject({ descendantCount: 1, generationSpan: 2, livingCount: 0 });
    expect((await admin.get(`/families/${familyId}`)).body.data.stats.branchCount).toBe(2);

    // Running it again does not duplicate branches.
    expect((await admin.post(`/families/${familyId}/branches/from-founder-children`)).body.data).toHaveLength(2);
  });

  it('keeps branch statistics current as the tree changes, and filters members by branch', async () => {
    const branch = (await admin.post(`/families/${familyId}/branches`, { name: 'House of Kwame', foundingMemberId: ids.kwame })).body.data;
    expect(branch.stats.descendantCount).toBe(2);
    await addPerson(admin, familyId, { firstName: 'Kojo' }, { parents: [{ memberId: ids.esi, subtype: 'biological', verification: 'verified' }] });
    expect((await admin.get(`/families/${familyId}/branches/${branch.id}`)).body.data.stats.descendantCount).toBe(3);

    const members = await admin.get(`/families/${familyId}/members?branchId=${branch.id}&sort=generation`);
    expect(members.body.data.map((p: { firstName: string }) => p.firstName)).toEqual(['Kwame', 'Yaw', 'Esi', 'Kojo']);

    const tree = await admin.get(`/families/${familyId}/tree/branches/${branch.id}?depth=6`);
    expect(tree.body.data.rootId).toBe(ids.kwame);
    expect(tree.body.data.nodes).toHaveLength(4);
  });

  it('allows one branch per founding member, edits, deletion and admin-only management', async () => {
    const created = await admin.post(`/families/${familyId}/branches`, { name: 'House of Kwame', foundingMemberId: ids.kwame });
    expect((await admin.post(`/families/${familyId}/branches`, { name: 'Again', foundingMemberId: ids.kwame })).status).toBe(409);
    const updated = await admin.patch(`/families/${familyId}/branches/${created.body.data.id}`, { description: 'Descendants of Kwame' });
    expect(updated.body.data.description).toBe('Descendants of Kwame');

    const member = await joinAs('member@example.org', 'family_member');
    expect((await member.get(`/families/${familyId}/branches`)).body.data).toHaveLength(1);
    expect((await member.post(`/families/${familyId}/branches`, { name: 'Mine', foundingMemberId: ids.ama })).status).toBe(403);

    expect((await admin.delete(`/families/${familyId}/branches/${created.body.data.id}`)).status).toBe(204);
    expect((await admin.get(`/families/${familyId}/branches`)).body.data).toHaveLength(0);
  });
});

describe('branch-scoped moderators', () => {
  it('may edit and link people only within their branches', async () => {
    const branches = (await admin.post(`/families/${familyId}/branches/from-founder-children`)).body.data;
    const kwameBranch = branches.find((b: { name: string }) => b.name.startsWith('Kwame')).id;
    const mod = await joinAs('mod@example.org', 'family_moderator', { moderatedBranchIds: [new Types.ObjectId(kwameBranch)] });

    const yaw = (await mod.get(`/families/${familyId}/members/${ids.yaw}`)).body.data;
    expect(yaw.viewerCan.update).toBe(true);
    expect((await mod.patch(`/families/${familyId}/members/${ids.yaw}`, { version: yaw.version, hometown: 'Kumasi' })).status).toBe(200);

    const abena = (await mod.get(`/families/${familyId}/members/${ids.abena}`)).body.data;
    expect(abena.viewerCan.update).toBe(false);
    expect((await mod.patch(`/families/${familyId}/members/${ids.abena}`, { version: 0, hometown: 'Accra' })).status).toBe(403);

    // Adding a child under their branch is allowed; under another branch it is not.
    const inside = await mod.post(`/families/${familyId}/members`, { person: { firstName: 'New' }, links: { parents: [{ memberId: ids.esi, subtype: 'biological' }] } });
    expect(inside.status).toBe(201);
    const outside = await mod.post(`/families/${familyId}/members`, { person: { firstName: 'Other' }, links: { parents: [{ memberId: ids.abena, subtype: 'biological' }] } });
    expect(outside.status).toBe(403);
    expect((await mod.post(`/families/${familyId}/members`, { person: { firstName: 'Unlinked' } })).status).toBe(403);
  });

  it('places unrestricted moderators across all branches', async () => {
    await admin.post(`/families/${familyId}/branches/from-founder-children`);
    const mod = await joinAs('mod@example.org', 'family_moderator');
    const abena = (await mod.get(`/families/${familyId}/members/${ids.abena}`)).body.data;
    expect((await mod.patch(`/families/${familyId}/members/${ids.abena}`, { version: abena.version, hometown: 'Accra' })).status).toBe(200);
  });
});
