import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { FamilyModel } from '../src/modules/families/family.model.js';
import { RelationshipModel } from '../src/modules/relationships/relationship.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, type TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let founderId: string;

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
  const res = await admin.post('/families', {
    name: 'Mensah Family',
    founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased', hometown: 'Kumasi', birthDate: { year: 1890, qualifier: 'about' } },
  });
  familyId = res.body.data.id;
  founderId = res.body.data.foundingMemberId;
});

async function joinAs(email: string, role: 'family_member' | 'family_moderator', extra: Record<string, unknown> = {}): Promise<TestClient> {
  const client = await registeredClient(ctx, email);
  const userId = (await UserModel.findOne({ email }))!._id;
  await FamilyMembershipModel.create({ familyId, userId, role, ...extra });
  return client;
}

const thisYear = new Date().getUTCFullYear();

describe('adding people', () => {
  it('creates a person with partial and approximate dates', async () => {
    const res = await admin.post(`/families/${familyId}/members`, {
      person: {
        firstName: 'Ama',
        surname: 'Mensah',
        maidenName: 'Owusu',
        gender: 'female',
        vitalStatus: 'deceased',
        birthDate: { year: 1921, month: 3, qualifier: 'exact' },
        deathDate: { year: 1990, endYear: 1995, qualifier: 'between' },
        occupations: [{ title: 'Cocoa trader', from: { year: 1945, qualifier: 'about' } }],
        sources: [{ title: 'Parish register, Kumasi', citation: 'Vol. 3, p. 41' }],
      },
      links: { parents: [{ memberId: founderId, subtype: 'biological', verification: 'verified' }] },
    });
    expect(res.status).toBe(201);
    const ama = res.body.data;
    expect(ama).toMatchObject({
      displayName: 'Ama Mensah',
      birthDate: { year: 1921, month: 3, qualifier: 'exact', sortKey: 19210300 },
      deathDate: { year: 1990, endYear: 1995, qualifier: 'between' },
      generation: { number: 2, status: 'computed' },
      viewerCan: { update: true, delete: true, manageRelationships: true },
    });
    expect(ama.relatives.parents).toEqual([expect.objectContaining({ subtype: 'biological', verification: 'verified', person: expect.objectContaining({ id: founderId, isFounder: true }) })]);

    const founder = await admin.get(`/families/${familyId}/members/${founderId}`);
    expect(founder.body.data.relatives.children.map((c: { person: { firstName: string } }) => c.person.firstName)).toEqual(['Ama']);
    expect((await admin.get(`/families/${familyId}`)).body.data.stats.memberCount).toBe(2);
  });

  it('validates dates and life status', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ firstName: 'X', birthDate: { year: 1950, month: 2, day: 30 } }, 'person.birthDate.day'],
      [{ firstName: 'X', birthDate: { day: 3, qualifier: 'exact' } }, 'person.birthDate.year'],
      [{ firstName: 'X', birthDate: { year: 1950, qualifier: 'between' } }, 'person.birthDate.endYear'],
      [{ firstName: 'X', vitalStatus: 'living', deathDate: { year: 2001 } }, 'person.vitalStatus'],
      [{ firstName: 'X', vitalStatus: 'living', privacy: { level: 'public' } }, 'person.privacy.level'],
      [{ firstName: '' }, 'person.firstName'],
    ];
    for (const [person, path] of cases) {
      const res = await admin.post(`/families/${familyId}/members`, { person });
      expect(res.status, path).toBe(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path), path).toContain(path);
    }
    const deathFirst = await admin.post(`/families/${familyId}/members`, {
      person: { firstName: 'X', vitalStatus: 'deceased', birthDate: { year: 1950, qualifier: 'exact' }, deathDate: { year: 1940, qualifier: 'exact' } },
    });
    expect(deathFirst.status).toBe(400);
    expect(deathFirst.body.error.details[0].path).toBe('deathDate');
  });

  it('accepts unknown dates described in words', async () => {
    const id = await addPerson(admin, familyId, { firstName: 'Yaa', birthDate: { qualifier: 'estimated', text: 'the year of the great flood' } });
    const res = await admin.get(`/families/${familyId}/members/${id}`);
    expect(res.body.data.birthDate).toMatchObject({ text: 'the year of the great flood', sortKey: null });
  });

  it('rolls back the person when a link is invalid', async () => {
    const res = await admin.post(`/families/${familyId}/members`, {
      person: { firstName: 'Orphan' },
      links: { parents: [{ memberId: '0123456789abcdef01234567', subtype: 'biological' }] },
    });
    expect(res.status).toBe(400);
    expect((await admin.get(`/families/${familyId}/members?q=orphan`)).body.data).toHaveLength(0);
  });

  it('asks ordinary members to go through review and lets moderators add people', async () => {
    const member = await joinAs('member@example.org', 'family_member');
    const denied = await member.post(`/families/${familyId}/members`, { person: { firstName: 'Kwaku' } });
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toMatch(/reviewed by a family administrator/);

    const moderator = await joinAs('mod@example.org', 'family_moderator');
    expect((await moderator.post(`/families/${familyId}/members`, { person: { firstName: 'Kwaku' } })).status).toBe(201);
  });
});

describe('editing and removing people', () => {
  it('updates with optimistic concurrency and refreshes search keys', async () => {
    const id = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah' });
    const current = (await admin.get(`/families/${familyId}/members/${id}`)).body.data;
    const res = await admin.patch(`/families/${familyId}/members/${id}`, { version: current.version, firstName: 'Kwabena', hometown: 'Accra' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ firstName: 'Kwabena', hometown: 'Accra' });
    expect((await admin.get(`/families/${familyId}/members?q=kwabena`)).body.data).toHaveLength(1);

    const stale = await admin.patch(`/families/${familyId}/members/${id}`, { version: current.version, firstName: 'Again' });
    expect(stale.status).toBe(409);
  });

  it('refuses to mark someone living while a death date is recorded', async () => {
    const id = await addPerson(admin, familyId, { firstName: 'Esi', vitalStatus: 'deceased', deathDate: { year: 1999 } });
    const { version } = (await admin.get(`/families/${familyId}/members/${id}`)).body.data;
    const res = await admin.patch(`/families/${familyId}/members/${id}`, { version, vitalStatus: 'living' });
    expect(res.status).toBe(400);
  });

  it('soft-deletes a person together with their relationships', async () => {
    const id = await addPerson(admin, familyId, { firstName: 'Yaw' }, { parents: [{ memberId: founderId, subtype: 'biological' }] });
    expect((await admin.delete(`/families/${familyId}/members/${id}`)).status).toBe(204);
    expect((await admin.get(`/families/${familyId}/members/${id}`)).status).toBe(404);
    expect(await RelationshipModel.countDocuments({ deletedAt: null })).toBe(0);
    expect(await RelationshipModel.countDocuments()).toBe(1);
    expect((await admin.get(`/families/${familyId}`)).body.data.stats.memberCount).toBe(1);
  });

  it('protects the founding ancestor from deletion', async () => {
    const res = await admin.delete(`/families/${familyId}/members/${founderId}`);
    expect(res.status).toBe(409);
  });
});

describe('privacy', () => {
  it('hides contact details from ordinary members but shows them to administrators', async () => {
    const id = await addPerson(admin, familyId, { firstName: 'Kojo', vitalStatus: 'living', birthDate: { year: 1980 }, contact: { phone: '+233 20 000 0000' } });
    const member = await joinAs('member@example.org', 'family_member');
    expect((await admin.get(`/families/${familyId}/members/${id}`)).body.data.contact).toEqual({ phone: '+233 20 000 0000' });
    const seen = (await member.get(`/families/${familyId}/members/${id}`)).body.data;
    expect(seen.contact).toBeNull();
    expect(seen.version).toBeNull();
    expect(seen.viewerCan).toMatchObject({ update: false, delete: false });
    expect(JSON.stringify(seen)).not.toContain('233');
  });

  it("reduces a child's date of birth to the year and hides their birthplace", async () => {
    const id = await addPerson(admin, familyId, {
      firstName: 'Abena',
      vitalStatus: 'living',
      birthDate: { year: thisYear - 8, month: 5, day: 14 },
      birthPlace: 'Korle Bu Teaching Hospital',
    });
    const member = await joinAs('member@example.org', 'family_member');
    const seen = (await member.get(`/families/${familyId}/members/${id}`)).body.data;
    expect(seen.birthDate).toEqual({ year: thisYear - 8, qualifier: 'exact', sortKey: (thisYear - 8) * 10000 });
    expect(seen.birthPlace).toBeNull();
    expect(seen.redacted).toBe(true);
    expect((await admin.get(`/families/${familyId}/members/${id}`)).body.data.birthDate.day).toBe(14);
  });

  it('shows restricted profiles to ordinary members as names only', async () => {
    const id = await addPerson(admin, familyId, { firstName: 'Kweku', surname: 'Mensah', vitalStatus: 'deceased', biography: 'Sensitive history', hometown: 'Obuasi', privacy: { level: 'restricted' } });
    const member = await joinAs('member@example.org', 'family_member');
    const seen = (await member.get(`/families/${familyId}/members/${id}`)).body.data;
    expect(seen).toMatchObject({ displayName: 'Kweku Mensah', biography: null, vitalStatus: null, hometown: null, redacted: true });
    // Filtering by a withheld detail must not reveal it.
    expect((await member.get(`/families/${familyId}/members?hometown=Obuasi`)).body.data).toHaveLength(0);
    expect((await admin.get(`/families/${familyId}/members?hometown=Obuasi`)).body.data).toHaveLength(1);
  });

  it('hides details of living people from members when the family chooses to', async () => {
    await FamilyModel.updateOne({ _id: familyId }, { 'privacy.showLivingToMembers': false });
    const id = await addPerson(admin, familyId, { firstName: 'Akua', vitalStatus: 'living', birthDate: { year: 1970 } });
    const member = await joinAs('member@example.org', 'family_member');
    expect((await member.get(`/families/${familyId}/members/${id}`)).body.data).toMatchObject({ birthDate: null, vitalStatus: null });
  });

  it('shows guests only deceased people the family has made public', async () => {
    const living = await addPerson(admin, familyId, { firstName: 'Living', vitalStatus: 'living' });
    const pub = await addPerson(admin, familyId, { firstName: 'Public', vitalStatus: 'deceased', privacy: { level: 'public' } }, { parents: [{ memberId: founderId, subtype: 'biological' }, { memberId: living, subtype: 'biological' }] });
    const anon = request(ctx.instance.app);

    // Private family: invisible entirely.
    expect((await anon.get(`/api/v1/families/${familyId}/members`)).status).toBe(404);

    await FamilyModel.updateOne({ _id: familyId }, { 'privacy.visibility': 'public' });
    const list = await anon.get(`/api/v1/families/${familyId}/members`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { firstName: string }) => p.firstName)).toEqual(['Public']);
    expect((await anon.get(`/api/v1/families/${familyId}/members/${living}`)).status).toBe(404);
    expect((await anon.get(`/api/v1/families/${familyId}/members/${founderId}`)).status).toBe(404);
    const profile = await anon.get(`/api/v1/families/${familyId}/members/${pub}`);
    expect(profile.status).toBe(200);
    // Relatives the guest may not see are omitted rather than shown redacted.
    expect(profile.body.data.relatives.parents).toEqual([]);
    expect(profile.body.data.viewerCan).toMatchObject({ update: false, viewPrivate: false });
  });
});

describe('search', () => {
  beforeEach(async () => {
    await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Asante', hometown: 'Kumasi', birthDate: { year: 1950 } });
    await addPerson(admin, familyId, { firstName: 'Quame', surname: 'Boateng', hometown: 'Accra', birthDate: { year: 1962 } });
    await addPerson(admin, familyId, { firstName: 'Akosua', surname: 'Mensah', maidenName: 'Owusu', hometown: 'Kumasi', birthDate: { year: 1950 } });
    await addPerson(admin, familyId, { firstName: 'Kwamé', middleNames: 'Kofi', surname: 'Ofori', hometown: 'Cape Coast' });
  });

  const names = (res: { body: { data: { displayName: string }[] } }) => res.body.data.map((p) => p.displayName);

  it('matches partial names, accents and maiden names', async () => {
    expect(names(await admin.get(`/families/${familyId}/members?q=kwa`))).toEqual(['Kwame Asante', 'Kwamé Ofori']);
    expect(names(await admin.get(`/families/${familyId}/members?q=owusu`))).toEqual(['Akosua Mensah']);
    expect(names(await admin.get(`/families/${familyId}/members?q=kwame%20of`))).toEqual(['Kwamé Ofori']);
  });

  it('finds spelling variations, ranking exact spellings first', async () => {
    expect(names(await admin.get(`/families/${familyId}/members?q=kwame`))).toEqual(['Kwame Asante', 'Kwamé Ofori', 'Quame Boateng']);
    expect(names(await admin.get(`/families/${familyId}/members?q=akossua`))).toEqual(['Akosua Mensah']);
  });

  it('filters by hometown, birth year and generation, and paginates', async () => {
    expect(names(await admin.get(`/families/${familyId}/members?hometown=kumasi&sort=name`))).toEqual(['Kwame Asante', 'Akosua Mensah', 'Kofi Mensah']);
    expect(names(await admin.get(`/families/${familyId}/members?birthYear=1950`))).toEqual(['Kwame Asante', 'Akosua Mensah']);
    expect(names(await admin.get(`/families/${familyId}/members?generation=1`))).toEqual(['Kofi Mensah']);
    const page = await admin.get(`/families/${familyId}/members?pageSize=2&page=2&sort=name`);
    expect(page.body.meta).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
  });

  it('offers a quick search endpoint for pickers', async () => {
    const res = await admin.get(`/families/${familyId}/members/search?q=men`);
    expect(names(res)).toEqual(['Akosua Mensah', 'Kofi Mensah']);
  });
});

describe('isolation', () => {
  it('never returns people from another family', async () => {
    const other = (await admin.post('/families', { name: 'Asante Family', founder: { firstName: 'Osei', surname: 'Asante' } })).body.data;
    expect((await admin.get(`/families/${familyId}/members/${other.foundingMemberId}`)).status).toBe(404);
    expect(names(await admin.get(`/families/${familyId}/members?q=osei`))).toEqual([]);
  });
});

function names(res: { body: { data: { displayName: string }[] } }) {
  return res.body.data.map((p) => p.displayName);
}
