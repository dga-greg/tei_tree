import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { FamilyModel } from '../src/modules/families/family.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { GenerationSnapshotModel } from '../src/modules/generations/generation-snapshot.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, link, registeredClient, type TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let kofi: string;

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
  const res = await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased', birthDate: { year: 1890 } } });
  familyId = res.body.data.id;
  kofi = res.body.data.foundingMemberId;
});

const child = (parent: string, person: Record<string, unknown>, verification = 'verified', subtype = 'biological') =>
  addPerson(admin, familyId, { surname: 'Mensah', ...person }, { parents: [{ memberId: parent, subtype, verification }] });
const generationOf = async (id: string) => (await admin.get(`/families/${familyId}/members/${id}`)).body.data.generation;

describe('automatic generation numbers', () => {
  it('numbers descendants as soon as they are added', async () => {
    const kwame = await child(kofi, { firstName: 'Kwame', vitalStatus: 'deceased', birthDate: { year: 1921 } });
    const yaw = await child(kwame, { firstName: 'Yaw', vitalStatus: 'living', birthDate: { year: 1950 } });
    expect(await generationOf(kofi)).toMatchObject({ number: 1, status: 'founder' });
    expect(await generationOf(kwame)).toMatchObject({ number: 2, status: 'computed' });
    expect(await generationOf(yaw)).toMatchObject({ number: 3, status: 'computed' });
  });

  it('classifies spouses, unverified and unconnected people', async () => {
    const akosua = await addPerson(admin, familyId, { firstName: 'Akosua' }, { partners: [{ memberId: kofi, subtype: 'marriage', verification: 'verified' }] });
    const maybe = await child(kofi, { firstName: 'Maybe' }, 'unverified');
    const loner = await addPerson(admin, familyId, { firstName: 'Loner' });
    expect(await generationOf(akosua)).toMatchObject({ number: null, status: 'married_in' });
    expect(await generationOf(maybe)).toMatchObject({ number: null, status: 'unverified_path', candidates: [2] });
    expect(await generationOf(loner)).toMatchObject({ number: null, status: 'unconnected' });
  });

  it('recalculates when a link is verified, removed or the adoptive policy changes', async () => {
    const adjoa = await child(kofi, { firstName: 'Adjoa' }, 'unverified', 'adoptive');
    expect((await generationOf(adjoa)).status).toBe('unverified_path');

    const edge = (await admin.get(`/families/${familyId}/members/${adjoa}`)).body.data.relatives.parents[0];
    const rel = (await admin.get(`/families/${familyId}/relationships/${edge.relationshipId}`)).body.data;
    await admin.patch(`/families/${familyId}/relationships/${rel.id}`, { version: rel.version, verification: 'verified' });
    expect(await generationOf(adjoa)).toMatchObject({ number: 2 });

    const family = (await admin.get(`/families/${familyId}`)).body.data;
    await admin.patch(`/families/${familyId}`, { version: family.version, generationPolicy: { countAdoptive: false } });
    expect((await generationOf(adjoa)).status).toBe('unconnected');

    await admin.patch(`/families/${familyId}`, { version: family.version + 1, generationPolicy: { countAdoptive: true } });
    await admin.delete(`/families/${familyId}/relationships/${rel.id}`);
    expect((await generationOf(adjoa)).status).toBe('unconnected');
  });

  it('renumbers everyone when an older ancestor becomes the founder', async () => {
    const kwame = await child(kofi, { firstName: 'Kwame' });
    const elder = await addPerson(admin, familyId, { firstName: 'Nana' }, { children: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
    expect((await generationOf(elder)).status).toBe('unconnected');
    await admin.put(`/families/${familyId}/founder`, { memberId: elder, reason: 'Older records found' });
    expect(await generationOf(elder)).toMatchObject({ number: 1, status: 'founder' });
    expect(await generationOf(kofi)).toMatchObject({ number: 2 });
    expect(await generationOf(kwame)).toMatchObject({ number: 3 });
  });
});

describe('generation statistics and dashboard', () => {
  it('builds the family dashboard', async () => {
    await child(kofi, { firstName: 'Kwame', vitalStatus: 'living' });
    const dash = (await admin.get(`/families/${familyId}/dashboard`)).body.data;
    expect(dash.stats).toEqual({ members: 2, generations: 2, living: 1, deceased: 1, branches: 0, pendingContributions: 0, conflicts: 0 });
    expect(dash.recentlyAdded[0].firstName).toBe('Kwame');
    expect(dash.growth).toHaveLength(12);
    expect(dash.growth.at(-1).added).toBe(2);
    expect(dash.byGeneration.map((b: { number: number }) => b.number)).toEqual([1, 2]);
  });

  it('keeps the dashboard from guests and restricts recalculation to administrators', async () => {
    await FamilyModel.updateOne({ _id: familyId }, { 'privacy.visibility': 'public' });
    const anon = request(ctx.instance.app);
    expect((await anon.get(`/api/v1/families/${familyId}/dashboard`)).status).toBe(401);

    const member = await registeredClient(ctx, 'member@example.org');
    await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email: 'member@example.org' }))!._id, role: 'family_member' });
    expect((await member.get(`/families/${familyId}/dashboard`)).status).toBe(200);
    expect((await member.post(`/families/${familyId}/generations/recalculate`)).status).toBe(403);

    const outsider = await registeredClient(ctx, 'outsider@example.org');
    expect((await outsider.get(`/families/${familyId}/dashboard`)).status).toBe(403);

    const recalc = await admin.post(`/families/${familyId}/generations/recalculate`);
    expect(recalc.status).toBe(202);
    expect(recalc.body.data.state.status).toBe('idle');
  });
});
