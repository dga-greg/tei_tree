import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RelationshipModel } from '../src/modules/relationships/relationship.model.js';
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
  const res = await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah' } });
  familyId = res.body.data.id;
  kofi = res.body.data.foundingMemberId;
});

const person = (firstName: string) => addPerson(admin, familyId, { firstName, surname: 'Mensah' });
const parentOf = (parent: string, child: string, subtype = 'biological') =>
  link(admin, familyId, { type: 'parent_child', personA: parent, personB: child, subtype });

describe('relationship integrity', () => {
  it('prevents cycles of any length', async () => {
    const kwame = await person('Kwame');
    const yaw = await person('Yaw');
    expect((await parentOf(kofi, kwame)).status).toBe(201);
    expect((await parentOf(kwame, yaw)).status).toBe(201);

    const direct = await parentOf(kwame, kofi);
    expect(direct.status).toBe(409);
    expect(direct.body.error.message).toMatch(/own ancestor/);
    expect((await parentOf(yaw, kofi, 'adoptive')).status).toBe(409);
    expect((await parentOf(kofi, kofi)).status).toBe(400);
  });

  it('rejects duplicate edges and allows re-adding after removal', async () => {
    const kwame = await person('Kwame');
    const first = await parentOf(kofi, kwame);
    expect((await parentOf(kofi, kwame, 'adoptive')).status).toBe(409);
    expect((await admin.delete(`/families/${familyId}/relationships/${first.body.data.id}`)).status).toBe(204);
    expect((await parentOf(kofi, kwame)).status).toBe(201);
  });

  it('allows at most two biological parents but any number of other parental links', async () => {
    const child = await person('Esi');
    const [mother, father, other, adoptive, step] = await Promise.all(['Ama', 'Kwesi', 'Third', 'Adopter', 'Stepdad'].map(person));
    expect((await parentOf(mother!, child)).status).toBe(201);
    expect((await parentOf(father!, child)).status).toBe(201);
    const third = await parentOf(other!, child);
    expect(third.status).toBe(409);
    expect(third.body.error.message).toMatch(/two biological parents/);
    expect((await parentOf(adoptive!, child, 'adoptive')).status).toBe(201);
    expect((await parentOf(step!, child, 'step')).status).toBe(201);
    // Changing an existing non-biological link to biological is subject to the same rule.
    const stepEdge = await RelationshipModel.findOne({ personA: step, deletedAt: null });
    const res = await admin.patch(`/families/${familyId}/relationships/${stepEdge!.id}`, { version: stepEdge!.get('version'), subtype: 'biological' });
    expect(res.status).toBe(409);
  });

  it('stores partnerships once regardless of direction and supports multiple partnerships', async () => {
    const ama = await person('Ama');
    const akosua = await person('Akosua');
    const first = await link(admin, familyId, { type: 'partnership', personA: ama, personB: kofi, subtype: 'customary_marriage', status: 'widowed' });
    expect(first.status).toBe(201);
    expect([first.body.data.personA, first.body.data.personB]).toEqual([ama, kofi].sort());
    expect((await link(admin, familyId, { type: 'partnership', personA: kofi, personB: ama, subtype: 'marriage' })).status).toBe(409);
    expect((await link(admin, familyId, { type: 'partnership', personA: kofi, personB: akosua, subtype: 'marriage' })).status).toBe(201);

    const profile = (await admin.get(`/families/${familyId}/members/${kofi}`)).body.data;
    expect(profile.relatives.partners.map((p: { person: { firstName: string }; status: string }) => [p.person.firstName, p.status]).sort()).toEqual([
      ['Akosua', 'current'],
      ['Ama', 'widowed'],
    ]);
  });

  it('does not let parent and child also be partners', async () => {
    const kwame = await person('Kwame');
    await parentOf(kofi, kwame);
    expect((await link(admin, familyId, { type: 'partnership', personA: kofi, personB: kwame, subtype: 'marriage' })).status).toBe(409);
    const ama = await person('Ama');
    await link(admin, familyId, { type: 'partnership', personA: kofi, personB: ama, subtype: 'marriage' });
    expect((await parentOf(kofi, ama)).status).toBe(409);
  });

  it('validates subtypes against the relationship type', async () => {
    const kwame = await person('Kwame');
    const res = await link(admin, familyId, { type: 'parent_child', personA: kofi, personB: kwame, subtype: 'marriage' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('subtype');
    const status = await link(admin, familyId, { type: 'parent_child', personA: kofi, personB: kwame, subtype: 'biological', status: 'divorced' });
    expect(status.status).toBe(400);
  });

  it('rejects links across families', async () => {
    const other = (await admin.post('/families', { name: 'Asante Family', founder: { firstName: 'Osei' } })).body.data;
    const res = await parentOf(kofi, other.foundingMemberId);
    expect(res.status).toBe(400);
  });

  it('serialises concurrent writes so a cycle cannot slip through', async () => {
    const a = await person('A');
    const b = await person('B');
    const results = await Promise.all([parentOf(a, b), parentOf(b, a)]);
    const created = results.filter((r) => r.status === 201).length;
    expect(created).toBe(1);
    expect(await RelationshipModel.countDocuments({ deletedAt: null, type: 'parent_child' })).toBe(1);
  });
});

describe('derived relatives', () => {
  it('classifies full, half and step/adoptive siblings', async () => {
    const [ama, akosua, kwame, yaw, esi, adopted] = await Promise.all(['Ama', 'Akosua', 'Kwame', 'Yaw', 'Esi', 'Adjoa'].map(person));
    // Kofi + Ama → Kwame, Yaw ; Kofi + Akosua → Esi ; Kofi adopted Adjoa
    for (const c of [kwame!, yaw!]) {
      await parentOf(kofi, c);
      await parentOf(ama!, c);
    }
    await parentOf(kofi, esi!);
    await parentOf(akosua!, esi!);
    await parentOf(kofi, adopted!, 'adoptive');

    const profile = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data;
    const kinds = Object.fromEntries(profile.relatives.siblings.map((s: { person: { firstName: string }; kind: string }) => [s.person.firstName, s.kind]));
    expect(kinds).toEqual({ Yaw: 'full', Esi: 'half', Adjoa: 'step_or_adoptive' });
    expect(profile.relatives.parents).toHaveLength(2);
  });

  it('updates verification and dates on a partnership', async () => {
    const ama = await person('Ama');
    const created = (await link(admin, familyId, { type: 'partnership', personA: kofi, personB: ama, subtype: 'marriage', verification: 'unverified' })).body.data;
    const res = await admin.patch(`/families/${familyId}/relationships/${created.id}`, {
      version: created.version,
      verification: 'verified',
      status: 'divorced',
      startDate: { year: 1915, qualifier: 'about' },
      endDate: { year: 1930 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ verification: 'verified', status: 'divorced', startDate: { year: 1915, qualifier: 'about' }, endDate: { year: 1930 } });
  });
});
