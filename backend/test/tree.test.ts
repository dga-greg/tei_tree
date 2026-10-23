import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { FamilyModel } from '../src/modules/families/family.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, link, registeredClient, type TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
const ids = {} as Record<'kofi' | 'akosua' | 'kwame' | 'adwoa' | 'yaw' | 'esi' | 'ama' | 'kweku', string>;

beforeAll(async () => {
  await connectTestDb();
  ctx = buildApp();
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});

/*
 *   Kofi ══ Akosua            (Akosua married in)
 *     ├── Kwame ══ Adwoa
 *     │     └── Yaw
 *     │          └── Esi       (generation 4)
 *     └── Ama   (adopted, by Kofi only)
 *   Kweku is Yaw's step-child (dotted link, not descent)
 */
beforeEach(async () => {
  await clearDb();
  admin = await registeredClient(ctx, 'admin@example.org');
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased' } })).body.data;
  familyId = fam.id;
  ids.kofi = fam.foundingMemberId;
  const add = (firstName: string, links?: Record<string, unknown>, extra: Record<string, unknown> = {}) => addPerson(admin, familyId, { firstName, surname: 'Mensah', ...extra }, links);
  const bio = (memberId: string) => ({ parents: [{ memberId, subtype: 'biological', verification: 'verified' }] });
  ids.akosua = await add('Akosua', { partners: [{ memberId: ids.kofi, subtype: 'marriage', verification: 'verified' }] });
  ids.kwame = await add('Kwame', { parents: [{ memberId: ids.kofi, subtype: 'biological', verification: 'verified' }, { memberId: ids.akosua, subtype: 'biological', verification: 'verified' }] });
  ids.adwoa = await add('Adwoa', { partners: [{ memberId: ids.kwame, subtype: 'marriage', verification: 'verified' }] });
  ids.yaw = await add('Yaw', bio(ids.kwame));
  ids.esi = await add('Esi', bio(ids.yaw), { vitalStatus: 'living' });
  ids.ama = await add('Ama', { parents: [{ memberId: ids.kofi, subtype: 'adoptive', verification: 'verified' }] });
  ids.kweku = await add('Kweku');
  await link(admin, familyId, { type: 'parent_child', personA: ids.yaw, personB: ids.kweku, subtype: 'step' });
});

const names = (w: { nodes: { firstName: string }[] }) => w.nodes.map((n) => n.firstName).sort();

describe('tree windows', () => {
  it('returns the founder and N generations with partners and all edges between them', async () => {
    const res = await admin.get(`/families/${familyId}/tree/root?depth=1`);
    expect(res.status).toBe(200);
    const w = res.body.data;
    expect(w.rootId).toBe(ids.kofi);
    // depth = generations below the root (1 = Kofi's children); partners of everyone included are added
    expect(names(w)).toEqual(['Adwoa', 'Akosua', 'Ama', 'Kofi', 'Kwame']);
    const kinds = w.edges.map((e: { type: string; subtype: string }) => `${e.type}:${e.subtype}`).sort();
    expect(kinds).toEqual(['parent_child:adoptive', 'parent_child:biological', 'parent_child:biological', 'partnership:marriage', 'partnership:marriage']);
    // Counts tell the client what can still be expanded.
    const kwame = w.nodes.find((n: { id: string }) => n.id === ids.kwame);
    expect(kwame).toMatchObject({ childCount: 1, parentCount: 2, generation: { number: 2 } });
  });

  it('expands one node at a time', async () => {
    const res = await admin.get(`/families/${familyId}/tree/nodes/${ids.yaw}/children`);
    expect(names(res.body.data)).toEqual(['Esi', 'Kweku', 'Yaw']);
    expect(res.body.data.edges.find((e: { subtype: string }) => e.subtype === 'step')).toMatchObject({ from: ids.yaw, to: ids.kweku });
  });

  it('returns ancestors of a person for search-and-focus', async () => {
    const res = await admin.get(`/families/${familyId}/tree/nodes/${ids.esi}/ancestors?depth=6`);
    expect(names(res.body.data)).toEqual(['Adwoa', 'Akosua', 'Esi', 'Kofi', 'Kwame', 'Yaw']);
  });

  it('validates depth and ids', async () => {
    expect((await admin.get(`/families/${familyId}/tree/root?depth=99`)).status).toBe(400);
    expect((await admin.get(`/families/${familyId}/tree/nodes/nope/children`)).status).toBe(404);
  });

  it('shows guests of a public family only public deceased people, without counting hidden relatives', async () => {
    await FamilyModel.updateOne({ _id: familyId }, { 'privacy.visibility': 'public' });
    const anon = request(ctx.instance.app);
    expect((await anon.get(`/api/v1/families/${familyId}/tree/root?depth=3`)).status).toBe(404); // founder not public

    const { version } = (await admin.get(`/families/${familyId}/members/${ids.kofi}`)).body.data;
    await admin.patch(`/families/${familyId}/members/${ids.kofi}`, { version, privacy: { level: 'public' } });
    const w = (await anon.get(`/api/v1/families/${familyId}/tree/root?depth=3`)).body.data;
    expect(names(w)).toEqual(['Kofi']);
    expect(w.nodes[0]).toMatchObject({ childCount: 0, parentCount: 0 });
    expect(w.edges).toEqual([]);
  });
});
