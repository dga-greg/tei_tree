import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { compareFamilyCodes } from '../src/modules/members/members.service.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, link, registeredClient, type TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let head: string;

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
  const res = await admin.post('/families', { name: 'Tei Family', founder: { firstName: 'Nii', surname: 'Tei', gender: 'male', vitalStatus: 'deceased' } });
  familyId = res.body.data.id;
  head = res.body.data.foundingMemberId;
});

const person = async (id: string) => (await admin.get(`/families/${familyId}/members/${id}`)).body.data;
const codeOf = async (id: string) => (await person(id)).familyCode as string | null;
const child = (parents: string | string[], p: Record<string, unknown>) =>
  addPerson(admin, familyId, { surname: 'Tei', ...p }, { parents: [parents].flat().map((memberId) => ({ memberId, subtype: 'biological', verification: 'verified' })) });
const spouse = (of: string, p: Record<string, unknown>) =>
  addPerson(admin, familyId, { surname: 'Tei', ...p }, { partners: [{ memberId: of, subtype: 'marriage', verification: 'verified' }] });

describe('family IDs', () => {
  it('numbers the head G1 and each generation below with a dot', async () => {
    expect(await codeOf(head)).toBe('G1');
    const a = await child(head, { firstName: 'Ayi', gender: 'male' });
    const b = await child(head, { firstName: 'Dede', gender: 'female' });
    const c = await child(head, { firstName: 'Tetteh', gender: 'male' });
    expect([await codeOf(a), await codeOf(b), await codeOf(c)]).toEqual(['G1.1', 'G1.2', 'G1.3']);
    const grandchild = await child(b, { firstName: 'Naa' });
    expect(await codeOf(grandchild)).toBe('G1.2.1');
    expect(await codeOf(await child(grandchild, { firstName: 'Kai' }))).toBe('G1.2.1.1');
  });

  it('gives husbands and wives their partner’s ID, and a child the line parent’s, preferring the father', async () => {
    const son = await child(head, { firstName: 'Ayi', gender: 'male' });
    const daughter = await child(head, { firstName: 'Dede', gender: 'female' });
    expect(await codeOf(await spouse(son, { firstName: 'Akua', gender: 'female' }))).toBe('G1.1-W1');
    const second = await spouse(son, { firstName: 'Esi', gender: 'female' });
    expect(await codeOf(second)).toBe('G1.1-W2');
    const husband = await spouse(daughter, { firstName: 'Kojo', gender: 'male', surname: 'Owusu' });
    expect(await codeOf(husband)).toBe('G1.2-H1');
    // A daughter's children are part of the family too.
    expect(await codeOf(await child([daughter, husband], { firstName: 'Ama' }))).toBe('G1.2.1');
    // Children of a wife from another family take their father's ID.
    expect(await codeOf(await child([second, son], { firstName: 'Yaw' }))).toBe('G1.1.1');
    // Both parents from the family: the father's line.
    const cousin = await child(son, { firstName: 'Kweku', gender: 'male' });
    const cousin2 = await child(daughter, { firstName: 'Abla', gender: 'female' });
    expect(await codeOf(await child([cousin2, cousin], { firstName: 'Baby' }))).toBe('G1.1.2.1');
  });

  it('never changes or reuses an ID, and numbers a child found later after the others', async () => {
    const a = await child(head, { firstName: 'Ayi', birthDate: { year: 1950 } });
    const b = await child(head, { firstName: 'Dede', birthDate: { year: 1952 } });
    expect((await admin.delete(`/families/${familyId}/members/${b}`)).status).toBe(204);
    const older = await child(head, { firstName: 'Firstborn', birthDate: { year: 1945 } });
    expect(await codeOf(older)).toBe('G1.3');
    expect(await codeOf(a)).toBe('G1.1');
    const p = await person(a);
    await admin.patch(`/families/${familyId}/members/${a}`, { version: p.version, firstName: 'Ayi Kwei', birthDate: { year: 1940 } });
    expect(await codeOf(a)).toBe('G1.1');
  });

  it('keeps every ID when an earlier family head is found', async () => {
    const son = await child(head, { firstName: 'Ayi' });
    const elder = await addPerson(admin, familyId, { firstName: 'Nii Ayi', surname: 'Tei', gender: 'male' }, { children: [{ memberId: head, subtype: 'biological', verification: 'verified' }] });
    expect(await codeOf(elder)).toBeNull();
    expect((await admin.put(`/families/${familyId}/founder`, { memberId: elder, reason: 'Older records found' })).status).toBe(200);
    expect(await codeOf(elder)).toBe('G0');
    expect([await codeOf(head), await codeOf(son)]).toEqual(['G1', 'G1.1']);
    // The earlier head's other children are numbered under him.
    expect(await codeOf(await child(elder, { firstName: 'Brother' }))).toBe('G0.1');
    // And again, further up.
    const older = await addPerson(admin, familyId, { firstName: 'Old', surname: 'Tei' }, { children: [{ memberId: elder, subtype: 'biological', verification: 'verified' }] });
    await admin.put(`/families/${familyId}/founder`, { memberId: older, reason: 'Even older' });
    expect(await codeOf(older)).toBe('G-1');
  });

  it('gives no ID to people not connected to the family yet, and one as soon as they are', async () => {
    const loner = await addPerson(admin, familyId, { firstName: 'Loner', surname: 'Tei' });
    expect(await codeOf(loner)).toBeNull();
    await link(admin, familyId, { type: 'parent_child', personA: head, personB: loner, subtype: 'biological' });
    expect(await codeOf(loner)).toBe('G1.1');
  });

  it('finds a person and everyone below them by ID, in ID order', async () => {
    const a = await child(head, { firstName: 'Ayi' });
    for (let i = 0; i < 10; i++) await child(a, { firstName: `Child${i}` });
    await spouse(a, { firstName: 'Wife', gender: 'female' });
    const res = await admin.get(`/families/${familyId}/members?q=g1.1`);
    const codes = res.body.data.map((p: { familyCode: string }) => p.familyCode);
    expect(codes.slice(0, 3)).toEqual(['G1.1', 'G1.1-W1', 'G1.1.1']);
    expect(codes.at(-1)).toBe('G1.1.10');
    expect(codes).toHaveLength(12);
    expect((await admin.get(`/families/${familyId}/members?q=G1.1.10`)).body.data.map((p: { firstName: string }) => p.firstName)).toEqual(['Child9']);
  });

  it('orders IDs as people read them', () => {
    expect(['G1.10', 'G1.2', 'G1', 'G1.2-W1', 'G0', 'G1.2.1', 'G-1'].sort(compareFamilyCodes)).toEqual(['G-1', 'G0', 'G1', 'G1.2', 'G1.2-W1', 'G1.2.1', 'G1.10']);
  });
});

describe('member details', () => {
  it('records the place of stay, common name and extra details, and suggests detail names', async () => {
    const id = await child(head, {
      firstName: 'Ayi',
      preferredName: 'Papa Ayi',
      gender: 'male',
      residence: 'Accra, Osu',
      vitalStatus: 'living',
      attributes: [
        { name: 'Occupation', value: 'Teacher' },
        { name: 'Church', value: 'Presby' },
      ],
    });
    const p = await person(id);
    expect(p).toMatchObject({ preferredName: 'Papa Ayi', residence: 'Accra, Osu', attributes: [{ name: 'Occupation', value: 'Teacher' }, { name: 'Church', value: 'Presby' }] });
    await child(head, { firstName: 'Dede', attributes: [{ name: 'Occupation', value: 'Nurse' }] });
    expect((await admin.get(`/families/${familyId}/attribute-names`)).body.data).toEqual(['Occupation', 'Church']);

    const updated = await admin.patch(`/families/${familyId}/members/${id}`, { version: p.version, attributes: [{ name: 'Occupation', value: 'Headmaster' }] });
    expect(updated.body.data.attributes).toEqual([{ name: 'Occupation', value: 'Headmaster' }]);
    const twice = await admin.patch(`/families/${familyId}/members/${id}`, { version: updated.body.data.version, attributes: [{ name: 'Occupation', value: 'a' }, { name: 'occupation', value: 'b' }] });
    expect(twice.status).toBe(400);
  });

  it('asks for the date of death only for the deceased', async () => {
    const res = await admin.post(`/families/${familyId}/members`, { person: { firstName: 'Ayi', vitalStatus: 'living', deathDate: { year: 2000 } } });
    expect(res.status).toBe(400);
    const ok = await admin.post(`/families/${familyId}/members`, { person: { firstName: 'Ayi', vitalStatus: 'deceased', birthDate: { year: 1920 }, deathDate: { year: 1990, month: 5, day: 2 } } });
    expect(ok.status).toBe(201);
  });

  it('takes a picture as the person’s photo', async () => {
    const id = await child(head, { firstName: 'Ayi' });
    const buffer = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#a33' } }).png().toBuffer();
    const up = await admin.upload(`/families/${familyId}/media`, { buffer, name: 'ayi.png', type: 'image/png' }, { profileOf: id });
    expect(up.status).toBe(201);
    expect((await person(id)).photoUrl).toMatch(/\/media\/[a-f0-9]+\/content\?variant=thumb/);
  });
});
