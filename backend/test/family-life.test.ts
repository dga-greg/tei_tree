import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LINEAGE_SETTINGS } from '@fh/contracts';
import { computeLineage } from '../src/modules/lineage/lineage-engine.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

describe('lineage engine', () => {
  // Grandmother Abena (Oyoko, parrot) → daughter Ama → Ama's children Kwame and Esi; Kwame's father Kofi (Bosompra).
  const people = [
    { id: 'abena', gender: 'female', maternalLine: 'Oyoko', totem: 'Parrot' },
    { id: 'ama', gender: 'female' },
    { id: 'kofi', gender: 'male', paternalLine: 'Bosompra' },
    { id: 'kwame', gender: 'male' },
    { id: 'esi', gender: 'female', maternalLine: 'Agona' },
    { id: 'yaw', gender: 'male' },
    { id: 'adopted', gender: 'male' },
  ];
  const links = [
    { parent: 'abena', child: 'ama', subtype: 'biological' },
    { parent: 'ama', child: 'kwame', subtype: 'biological' },
    { parent: 'kofi', child: 'kwame', subtype: 'biological' },
    { parent: 'ama', child: 'esi', subtype: 'biological' },
    { parent: 'kwame', child: 'yaw', subtype: 'biological' },
    { parent: 'ama', child: 'adopted', subtype: 'adoptive' },
  ];

  it('passes the maternal line through mothers and the paternal line through fathers', () => {
    const lines = computeLineage(people, links, DEFAULT_LINEAGE_SETTINGS);
    expect(lines.get('kwame')).toEqual({ maternal: { name: 'Oyoko', sourceId: 'abena' }, paternal: { name: 'Bosompra', sourceId: 'kofi' }, totem: { name: 'Parrot', sourceId: 'abena' } });
    // A man does not pass on his maternal line; his son takes his paternal line.
    expect(lines.get('yaw')).toEqual({ maternal: null, paternal: { name: 'Bosompra', sourceId: 'kofi' }, totem: null });
    // A recorded value that differs from what the mother would pass on is kept, and the difference noted.
    expect(lines.get('esi')!.maternal).toEqual({ name: 'Agona', sourceId: 'esi', inheritedWouldBe: 'Oyoko' });
    // Adoptive parents pass nothing on unless the family says so.
    expect(lines.get('adopted')!.maternal).toBeNull();
    expect(computeLineage(people, links, { ...DEFAULT_LINEAGE_SETTINGS, throughAdoption: true }).get('adopted')!.maternal).toEqual({ name: 'Oyoko', sourceId: 'abena' });
  });

  it('follows the family settings', () => {
    const settings = { ...DEFAULT_LINEAGE_SETTINGS, paternal: { enabled: false, label: 'Ntoro' }, totemFollows: 'paternal' as const };
    const lines = computeLineage([...people, { id: 'kofi2', gender: 'male', totem: 'Leopard' }], [...links, { parent: 'kofi2', child: 'esi', subtype: 'biological' }], settings);
    expect(lines.get('kwame')!.paternal).toBeNull();
    expect(lines.get('esi')!.totem).toEqual({ name: 'Leopard', sourceId: 'kofi2' });
    expect(lines.get('kwame')!.totem).toBeNull();
    // Disputed links pass nothing on.
    expect(computeLineage(people, links.map((l) => ({ ...l, verification: 'disputed' })), DEFAULT_LINEAGE_SETTINGS).get('kwame')!.maternal).toBeNull();
  });
});

// ------------------------------------------------------------------ through the API

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let ids: Record<string, string>;

async function member(email: string, name: string, profileId?: string): Promise<{ client: TestClient; membershipId: string }> {
  const client = await registeredClient(ctx, email, name);
  const user = await UserModel.findOneAndUpdate({ email }, { emailVerifiedAt: new Date() });
  const m = await FamilyMembershipModel.create({ familyId, userId: user!._id, role: 'family_member', memberProfileId: profileId ?? null });
  return { client, membershipId: m.id as string };
}

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
  admin = await registeredClient(ctx, 'admin@example.org', 'Ama Admin');
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Abena', surname: 'Mensah', gender: 'female', vitalStatus: 'deceased', maternalLine: 'Oyoko', totem: 'Parrot' } })).body.data;
  familyId = fam.id;
  const abena = fam.foundingMemberId;
  const kofi = await addPerson(admin, familyId, { firstName: 'Kofi', surname: 'Asante', gender: 'male', paternalLine: 'Bosompra' });
  const ama = await addPerson(admin, familyId, { firstName: 'Ama', surname: 'Mensah', gender: 'female' }, { parents: [{ memberId: abena, subtype: 'biological', verification: 'verified' }], partners: [{ memberId: kofi, subtype: 'marriage', verification: 'verified' }] });
  const kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Asante', gender: 'male', vitalStatus: 'living' }, { parents: [{ memberId: ama, subtype: 'biological', verification: 'verified' }, { memberId: kofi, subtype: 'biological', verification: 'verified' }] });
  const esi = await addPerson(admin, familyId, { firstName: 'Esi', surname: 'Asante', gender: 'female', vitalStatus: 'living' }, { parents: [{ memberId: ama, subtype: 'biological', verification: 'verified' }, { memberId: kofi, subtype: 'biological', verification: 'verified' }] });
  ids = { abena, kofi, ama, kwame, esi };
});

describe('lineage', () => {
  it("shows each person's lines, where they come from, and the family's lines", async () => {
    const kwame = (await admin.get(`/families/${familyId}/members/${ids['kwame']}`)).body.data;
    expect(kwame.lineage.maternal).toMatchObject({ name: 'Oyoko', source: 'inherited', from: { id: ids['abena'], displayName: 'Abena Mensah' } });
    expect(kwame.lineage.paternal).toMatchObject({ name: 'Bosompra', source: 'inherited', from: { id: ids['kofi'] } });
    expect(kwame.lineage.totem).toMatchObject({ name: 'Parrot', source: 'inherited' });
    expect(kwame.maternalLine).toBe('');

    const overview = (await admin.get(`/families/${familyId}/lineages?side=maternal`)).body.data;
    expect(overview.settings).toEqual(DEFAULT_LINEAGE_SETTINGS);
    expect(overview.groups).toHaveLength(1);
    expect(overview.groups[0]).toMatchObject({ name: 'Oyoko', totems: ['Parrot'], members: 4, living: 2, roots: [{ id: ids['abena'] }], differences: 0 });
    expect(overview.unknown).toBe(1); // Kofi
    const paternal = (await admin.get(`/families/${familyId}/lineages?side=paternal`)).body.data;
    expect(paternal.groups.map((g: { name: string; members: number }) => [g.name, g.members])).toEqual([['Bosompra', 3]]);

    // The tree carries lines for colouring.
    const tree = (await admin.get(`/families/${familyId}/tree/root?depth=3`)).body.data;
    expect(tree.nodes.find((n: { id: string }) => n.id === ids['esi']).lineage).toEqual({ maternal: 'Oyoko', paternal: 'Bosompra' });

    // Recording a different line on someone is kept, and noted.
    const esi = (await admin.get(`/families/${familyId}/members/${ids['esi']}`)).body.data;
    await admin.patch(`/families/${familyId}/members/${ids['esi']}`, { version: esi.version, maternalLine: 'Agona' });
    const after = (await admin.get(`/families/${familyId}/members/${ids['esi']}`)).body.data;
    expect(after.lineage.maternal).toEqual({ name: 'Agona', source: 'own', from: null, inheritedWouldBe: 'Oyoko' });
    expect((await admin.get(`/families/${familyId}/lineages?side=maternal`)).body.data.groups.find((g: { name: string }) => g.name === 'Agona')).toMatchObject({ members: 1, differences: 1 });
  });

  it('follows the family settings', async () => {
    const fam = (await admin.get(`/families/${familyId}`)).body.data;
    const res = await admin.patch(`/families/${familyId}`, { version: fam.version, lineage: { maternal: { enabled: true, label: 'Clan' }, paternal: { enabled: false, label: 'Ntoro' }, totemFollows: 'maternal', throughAdoption: true } });
    expect(res.status).toBe(200);
    expect(res.body.data.lineage.maternal.label).toBe('Clan');
    const kwame = (await admin.get(`/families/${familyId}/members/${ids['kwame']}`)).body.data;
    expect(kwame.lineage.paternal).toBeNull();
    const m = await member('m@example.org', 'Mary');
    expect((await m.client.patch(`/families/${familyId}`, { version: fam.version + 1, lineage: { maternal: { enabled: false, label: 'x' }, paternal: { enabled: false, label: 'y' }, totemFollows: 'maternal', throughAdoption: false } })).status).toBe(403);
  });
});

describe('ceremonies', () => {
  it('records a programme and roles, and is listed among ceremonies', async () => {
    const fund = (await admin.post(`/families/${familyId}/funds`, { name: "Abena's funeral", kind: 'ceremony', currency: 'GHS', target: 5_000_000 })).body.data;
    const res = await admin.post(`/families/${familyId}/events`, {
      kind: 'funeral',
      title: 'Funeral of Abena Mensah',
      date: { year: 2026, month: 11, day: 21 },
      place: 'Kumasi',
      memberIds: [ids['abena']],
      programme: [{ time: '06:00', title: 'Wake keeping', lead: 'Family spokesperson' }, { time: '09:00', title: 'Burial service', detail: 'Methodist church' }],
      roles: [{ role: 'Chief mourner', memberId: ids['ama'] }, { role: 'Officiating minister', name: 'Rev. Asare' }],
      fundId: fund.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: 'funeral',
      programme: [{ time: '06:00', title: 'Wake keeping', lead: 'Family spokesperson' }, { time: '09:00', title: 'Burial service', detail: 'Methodist church' }],
      roles: [{ role: 'Chief mourner', person: { id: ids['ama'] }, name: 'Ama Mensah' }, { role: 'Officiating minister', person: null, name: 'Rev. Asare' }],
      fund: { id: fund.id, name: "Abena's funeral" },
    });
    await admin.post(`/families/${familyId}/events`, { kind: 'reunion', title: 'Reunion', date: { year: 2026 } });
    const ceremonies = (await admin.get(`/families/${familyId}/events?ceremonies=true`)).body.data;
    expect(ceremonies.map((e: { title: string }) => e.title)).toEqual(['Funeral of Abena Mensah']);
    expect((await admin.get(`/families/${familyId}/calendar?from=2026-11-01&to=2026-11-30`)).body.data.map((i: { title: string }) => i.title)).toContain('Funeral of Abena Mensah');
    expect((await admin.post(`/families/${familyId}/events`, { kind: 'wedding', title: 'W', roles: [{ role: 'Best man' }] })).status).toBe(400);
  });
});

describe('family funds', () => {
  it('lets administrators and treasurers keep the accounts, and shows members what each fund allows', async () => {
    const kwameAccount = await member('kwame@example.org', 'Kwame', ids['kwame']);
    const kwame = kwameAccount.client;
    expect((await kwame.post(`/families/${familyId}/funds`, { name: 'Dues', kind: 'dues', dues: { amount: 5000, period: 'monthly' } })).status).toBe(403);
    // Dues need an amount; currencies must be real.
    expect((await admin.post(`/families/${familyId}/funds`, { name: 'Dues', kind: 'dues' })).status).toBe(400);
    expect((await admin.post(`/families/${familyId}/funds`, { name: 'Dues', kind: 'other', currency: 'XYZ' })).status).toBe(400);
    const dues = (await admin.post(`/families/${familyId}/funds`, { name: 'Monthly dues', kind: 'dues', currency: 'GHS', dues: { amount: 5000, period: 'monthly' }, payerIds: [ids['kwame'], ids['esi']], visibility: 'totals' })).body.data;
    expect(dues).toMatchObject({ currency: 'GHS', dues: { amount: 5000, period: 'monthly' }, payers: [{ id: ids['kwame'] }, { id: ids['esi'] }], totals: { amount: 0, count: 0 } });

    // Kwame becomes treasurer and records money.
    const memberships = (await admin.get(`/families/${familyId}/memberships`)).body.data;
    const kwameMembership = memberships.find((x: { user: { email: string } }) => x.user.email === 'kwame@example.org');
    expect((await admin.patch(`/families/${familyId}/memberships/${kwameMembership.id}`, { treasurer: true })).status).toBe(200);
    expect((await kwame.get('/families')).body.data[0]).toMatchObject({ role: 'family_member', treasurer: true });
    const pay = (body: object) => kwame.post(`/families/${familyId}/funds/${dues.id}/contributions`, { method: 'mobile_money', ...body });
    expect((await pay({ memberId: ids['kwame'], amount: 5000, date: '2026-10-05', reference: 'MM-123' })).status).toBe(201);
    expect((await pay({ memberId: ids['esi'], amount: 2000, date: '2026-10-07' })).status).toBe(201);
    expect((await pay({ contributorName: '=HYPERLINK("http://evil")', amount: 1000, date: '2026-09-30' })).status).toBe(201);
    expect((await pay({ amount: 1000, date: '2026-10-01' })).status).toBe(400);
    expect((await pay({ memberId: ids['kwame'], amount: 10.5, date: '2026-10-01' })).status).toBe(400);
    expect((await kwame.get(`/families/${familyId}/funds/${dues.id}`)).body.data.totals).toEqual({ amount: 8000, count: 3, contributors: 3 });

    // Dues for October: Kwame paid in full, Esi owes 30.00.
    const report = (await admin.get(`/families/${familyId}/funds/${dues.id}/report?period=2026-10`)).body.data;
    expect(report.dues).toMatchObject({ period: '2026-10', totals: { due: 10000, paid: 7000 } });
    expect(report.dues.rows.map((r: { person: { id: string }; paid: number; balance: number }) => [r.person.id, r.paid, r.balance])).toEqual([[ids['esi'], 2000, 3000], [ids['kwame'], 5000, 0]]);
    expect(report.byMonth).toEqual([{ month: '2026-09', amount: 1000 }, { month: '2026-10', amount: 7000 }]);

    // By branch: Ama's branch holds both children; the outside contributor is in no branch.
    await admin.post(`/families/${familyId}/branches`, { name: "Ama's house", foundingMemberId: ids['ama'] });
    const byBranch = (await admin.get(`/families/${familyId}/funds/${dues.id}/report`)).body.data.byBranch;
    expect(byBranch).toEqual([{ branch: { id: expect.any(String), name: "Ama's house" }, amount: 7000, count: 2 }, { branch: null, amount: 1000, count: 1 }]);

    // CSV: amounts in cedis, formulas neutralised.
    const csv = await admin.get(`/families/${familyId}/funds/${dues.id}/export`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Amount (GHS)');
    expect(csv.text).toContain(',50.00,mobile_money,MM-123,');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);

    // An ordinary member sees the fund and its totals, but only their own contributions.
    const esiAccount = await member('esi@example.org', 'Esi', ids['esi']);
    const list = (await esiAccount.client.get(`/families/${familyId}/funds`)).body.data;
    expect(list[0]).toMatchObject({ name: 'Monthly dues', totals: { amount: 8000 }, payers: [], viewerCan: { manage: false, seeContributions: false } });
    const own = (await esiAccount.client.get(`/families/${familyId}/funds/${dues.id}/contributions`)).body.data;
    expect(own.map((c: { amount: number }) => c.amount)).toEqual([2000]);
    expect(own[0].reference).toBe('');
    expect((await esiAccount.client.get(`/families/${familyId}/funds/${dues.id}/report`)).status).toBe(403);
    expect((await esiAccount.client.get(`/families/${familyId}/funds/mine`)).body.data).toMatchObject([{ amount: 2000, fund: { name: 'Monthly dues', currency: 'GHS' } }]);

    // Funds kept to administrators are invisible to members.
    const secret = (await admin.post(`/families/${familyId}/funds`, { name: 'Legal fees', kind: 'other', visibility: 'admins' })).body.data;
    expect((await esiAccount.client.get(`/families/${familyId}/funds`)).body.data.map((f: { name: string }) => f.name)).toEqual(['Monthly dues']);
    expect((await esiAccount.client.get(`/families/${familyId}/funds/${secret.id}`)).status).toBe(404);

    // The currency is fixed once money is recorded; closed funds take no more.
    expect((await admin.patch(`/families/${familyId}/funds/${dues.id}`, { version: dues.version, currency: 'USD' })).status).toBe(409);
    const closed = await admin.patch(`/families/${familyId}/funds/${dues.id}`, { version: dues.version, status: 'closed' });
    expect(closed.body.data.status).toBe('closed');
    expect((await pay({ memberId: ids['kwame'], amount: 5000, date: '2026-11-05' })).status).toBe(409);
    expect(await AuditLogModel.countDocuments({ familyId, action: { $regex: /^fund\./ } })).toBeGreaterThanOrEqual(7);
  });
});
