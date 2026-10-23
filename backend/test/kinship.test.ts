import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { FamilyModel } from '../src/modules/families/family.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, link, registeredClient, type TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
const ids = {} as Record<'kofi' | 'kwame' | 'ama' | 'yaw' | 'abena' | 'adwoa', string>;

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
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', gender: 'male' } })).body.data;
  familyId = fam.id;
  ids.kofi = fam.foundingMemberId;
  const child = (firstName: string, gender: string, parent: string) =>
    addPerson(admin, familyId, { firstName, surname: 'Mensah', gender }, { parents: [{ memberId: parent, subtype: 'biological', verification: 'verified' }] });
  ids.kwame = await child('Kwame', 'male', ids.kofi);
  ids.ama = await child('Ama', 'female', ids.kofi);
  ids.yaw = await child('Yaw', 'male', ids.kwame);
  ids.abena = await child('Abena', 'female', ids.ama);
  ids.adwoa = await addPerson(admin, familyId, { firstName: 'Adwoa', surname: 'Owusu', gender: 'female' }, { partners: [{ memberId: ids.kwame, subtype: 'marriage', verification: 'verified' }] });
});

const between = (a: string, b: string, client = admin) => client.get(`/families/${familyId}/relationships/between?a=${a}&b=${b}`);

describe('relationship finder API', () => {
  it('names a blood relationship with the path, common ancestor and reciprocal', async () => {
    const res = await between(ids.yaw, ids.abena);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r).toMatchObject({
      kind: 'blood',
      term: 'first cousin',
      reciprocal: 'first cousin',
      summary: "Yaw Mensah is Abena Mensah's first cousin.",
      confidence: 'verified',
      blood: { fromA: 2, fromB: 2, cousinDegree: 1, removed: 0 },
    });
    expect(r.commonAncestors.map((p: { firstName: string }) => p.firstName)).toEqual(['Kofi']);
    expect(r.path.people.map((p: { firstName: string }) => p.firstName)).toEqual(['Yaw', 'Kwame', 'Kofi', 'Ama', 'Abena']);
    expect(r.path.steps.map((s: { label: string }) => s.label)).toEqual(['father', 'father', 'daughter', 'daughter']);
  });

  it('handles relationships by marriage', async () => {
    const r = (await between(ids.adwoa, ids.abena)).body.data;
    expect(r).toMatchObject({ kind: 'marriage', term: 'aunt by marriage', reciprocal: 'niece by marriage' });
    expect((await between(ids.adwoa, ids.kofi)).body.data.term).toBe('daughter-in-law');
  });

  it('reflects new links immediately (the cached graph is invalidated)', async () => {
    // Adwoa married Kwame, Yaw's father, but is not recorded as Yaw's mother yet.
    expect((await between(ids.yaw, ids.adwoa)).body.data).toMatchObject({ kind: 'step', term: 'stepson' });
    await link(admin, familyId, { type: 'parent_child', personA: ids.adwoa, personB: ids.yaw, subtype: 'biological' });
    const after = (await between(ids.yaw, ids.adwoa)).body.data;
    expect(after).toMatchObject({ kind: 'blood', term: 'son' });
  });

  it('reflects renamed people and new people immediately', async () => {
    expect((await between(ids.yaw, ids.abena)).body.data.summary).toBe("Yaw Mensah is Abena Mensah's first cousin.");
    const ama = (await admin.get(`/families/${familyId}/members/${ids.abena}`)).body.data;
    await admin.patch(`/families/${familyId}/members/${ids.abena}`, { version: ama.version, firstName: 'Abenaa' });
    expect((await between(ids.yaw, ids.abena)).body.data.summary).toBe("Yaw Mensah is Abenaa Mensah's first cousin.");
    const esi = await addPerson(admin, familyId, { firstName: 'Esi', surname: 'Mensah', gender: 'female' }, { parents: [{ memberId: ids.yaw, subtype: 'biological', verification: 'verified' }] });
    expect((await between(esi, ids.kofi)).body.data.term).toBe('great-granddaughter');
  });

  it('says so when people are not connected', async () => {
    const stranger = await addPerson(admin, familyId, { firstName: 'Stranger' });
    const r = (await between(ids.yaw, stranger)).body.data;
    expect(r).toMatchObject({ kind: 'not_found', term: null });
    expect(r.path.people).toEqual([]);
  });

  it('is for family members only and rejects unknown people', async () => {
    await FamilyModel.updateOne({ _id: familyId }, { 'privacy.visibility': 'public' });
    expect((await request(ctx.instance.app).get(`/api/v1/families/${familyId}/relationships/between?a=${ids.yaw}&b=${ids.abena}`)).status).toBe(401);
    const outsider = await registeredClient(ctx, 'outsider@example.org');
    expect((await between(ids.yaw, ids.abena, outsider)).status).toBe(403);
    expect((await between(ids.yaw, new Types.ObjectId().toString())).status).toBe(404);
    expect((await between(ids.yaw, 'nope')).status).toBe(404);
    expect((await admin.get(`/families/${familyId}/relationships/between?a=${ids.yaw}`)).status).toBe(400);
  });

  it('never crosses into another family', async () => {
    const other = (await admin.post('/families', { name: 'Asante Family', founder: { firstName: 'Osei' } })).body.data;
    expect((await between(ids.yaw, other.foundingMemberId)).status).toBe(404);
  });
});
