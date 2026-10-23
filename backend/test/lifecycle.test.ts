import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { gedcomDate, toGedcom } from '../src/modules/export/gedcom.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { FamilyModel } from '../src/modules/families/family.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { FamilyMediaModel } from '../src/modules/media/media.model.js';
import { FamilyMemberModel } from '../src/modules/members/member.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TEST_PASSWORD, TestClient, type TestContext } from './helpers.js';

describe('GEDCOM writer', () => {
  it('maps fuzzy dates to GEDCOM date values', () => {
    expect(gedcomDate({ year: 1950, month: 3, day: 12, qualifier: 'exact' })).toBe('12 MAR 1950');
    expect(gedcomDate({ year: 1950, month: 3, qualifier: 'exact' })).toBe('MAR 1950');
    expect(gedcomDate({ year: 1890, qualifier: 'about' })).toBe('ABT 1890');
    expect(gedcomDate({ year: 1900, qualifier: 'before' })).toBe('BEF 1900');
    expect(gedcomDate({ year: 1900, qualifier: 'after' })).toBe('AFT 1900');
    expect(gedcomDate({ year: 1900, endYear: 1910, qualifier: 'between' })).toBe('BET 1900 AND 1910');
    expect(gedcomDate({ year: 1900, qualifier: 'estimated' })).toBe('EST 1900');
    expect(gedcomDate({ qualifier: 'estimated', text: 'the year of the flood' })).toBe('(the year of the flood)');
    expect(gedcomDate(null)).toBeNull();
  });

  it('writes people, couples and children with their kind of parent link', () => {
    const text = toGedcom({
      familyName: 'Mensah Family',
      exportedAt: new Date('2026-10-16T00:00:00Z'),
      people: [
        { id: 'kofi', firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1885, qualifier: 'about' }, birthPlace: 'Cape Coast', biography: `Line one ${'x'.repeat(450)}\nLine two with an @ sign` },
        { id: 'akosua', firstName: 'Akosua', surname: 'Mensah', maidenName: 'Owusu', gender: 'female', vitalStatus: 'deceased' },
        { id: 'kwame', firstName: 'Kwame', middleNames: 'Kofi', surname: 'Mensah', preferredName: 'Kay', gender: 'male' },
        { id: 'ama', firstName: 'Ama', surname: 'Mensah', gender: 'female', vitalStatus: 'living', privatised: true },
      ],
      parentLinks: [
        { parentId: 'kofi', childId: 'kwame', subtype: 'biological' },
        { parentId: 'akosua', childId: 'kwame', subtype: 'biological' },
        { parentId: 'kofi', childId: 'ama', subtype: 'adoptive' },
      ],
      partnerships: [{ id: 'p1', personA: 'akosua', personB: 'kofi', subtype: 'customary_marriage', status: 'widowed', startDate: { year: 1910, qualifier: 'exact' } }],
    });
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('0 HEAD');
    expect(lines).toContain('2 VERS 5.5.1');
    expect(lines).toContain('1 CHAR UTF-8');
    expect(lines.at(-2)).toBe('0 TRLR');
    expect(lines).toContain('1 NAME Kofi /Mensah/');
    expect(lines).toContain('1 NAME Kwame Kofi /Mensah/');
    expect(lines).toContain('2 NICK Kay');
    expect(lines).toContain('1 NAME Akosua /Owusu/');
    expect(lines).toContain('2 PLAC Cape Coast');
    expect(lines).toContain('2 DATE ABT 1885');
    // Long notes are split (CONC) and keep line breaks (CONT); @ is escaped.
    expect(lines.some((l) => l.startsWith('2 CONC '))).toBe(true);
    expect(lines).toContain('2 CONT Line two with an @@ sign');
    // The couple's family holds their child; the adoptive link is a separate family with PEDI adopted.
    const fam1 = text.slice(text.indexOf('0 @F1@ FAM'));
    expect(fam1).toMatch(/^0 @F1@ FAM\r\n1 HUSB @I1@\r\n1 WIFE @I2@\r\n1 CHIL @I3@\r\n1 MARR\r\n2 DATE 1910\r\n2 TYPE Customary marriage/);
    expect(text).toContain('0 @F2@ FAM\r\n1 HUSB @I1@\r\n1 CHIL @I4@');
    expect(text).toContain('1 FAMC @F2@\r\n2 PEDI adopted');
    // Privatised living people keep only a placeholder.
    expect(text).toContain('0 @I4@ INDI\r\n1 NAME Living /Mensah/\r\n1 RESN privacy');
    expect(text).not.toContain('Ama');
    // Every line respects the 255-character limit.
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(255);
  });
});

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let kofi: string;
let kwame: string;

async function member(email: string, role = 'family_member'): Promise<TestClient> {
  const client = await registeredClient(ctx, email, email.split('@')[0]);
  await UserModel.updateOne({ email }, { emailVerifiedAt: new Date() });
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role });
  return client;
}

beforeAll(async () => {
  await connectTestDb();
  ctx = buildApp({ FAMILY_DELETION_GRACE_DAYS: '30', MEDIA_RETENTION_DAYS: '30' });
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  admin = await registeredClient(ctx, 'admin@example.org', 'Ama Admin');
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1885, qualifier: 'about' } } })).body.data;
  familyId = fam.id;
  kofi = fam.foundingMemberId;
  kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', vitalStatus: 'living', birthDate: { year: 1950 }, contact: { phone: '+233 20 000 0000' } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
});

describe('family export', () => {
  it('gives administrators a complete JSON or GEDCOM copy, optionally without living people', async () => {
    const json = await admin.get(`/families/${familyId}/export`);
    expect(json.status).toBe(200);
    expect(json.headers['content-disposition']).toMatch(/^attachment; filename="mensah-family-\d{4}-\d{2}-\d{2}\.json"/);
    const doc = JSON.parse(json.text);
    expect(doc.format).toBe('family-heritage/v1');
    expect(doc.people.map((p: { firstName: string }) => p.firstName).sort()).toEqual(['Kofi', 'Kwame']);
    expect(doc.relationships).toHaveLength(1);
    expect(doc.relationships[0]).toMatchObject({ type: 'parent_child', personA: kofi, personB: kwame });
    expect(doc.people.find((p: { id: string }) => p.id === kwame).contact.phone).toBe('+233 20 000 0000');
    expect(json.text).not.toMatch(/searchTokens|phoneticKeys|storageKey|passwordHash/);

    const shared = JSON.parse((await admin.get(`/families/${familyId}/export?living=private`)).text);
    expect(shared.people.find((p: { id: string }) => p.id === kwame)).toEqual({ id: kwame, firstName: 'Living', surname: 'Mensah', living: true });

    const ged = await admin.get(`/families/${familyId}/export?format=gedcom`);
    expect(ged.headers['content-type']).toContain('text/vnd.familysearch.gedcom');
    expect(ged.text).toContain('1 NAME Kwame /Mensah/');
    expect(ged.text).toContain('2 DATE ABT 1885');
    expect(ged.text.endsWith('0 TRLR\r\n')).toBe(true);

    const m = await member('m@example.org');
    expect((await m.get(`/families/${familyId}/export`)).status).toBe(403);
    expect(await AuditLogModel.countDocuments({ familyId, action: 'family.export' })).toBe(3);
  });

  it('lets every account download its own data', async () => {
    await admin.post(`/families/${familyId}/stories`, { kind: 'memory', title: 'Sundays', body: 'Lunch at Kofi’s.' });
    const res = await admin.get('/account/export');
    expect(res.headers['content-disposition']).toContain('attachment; filename="my-data-');
    const doc = JSON.parse(res.text);
    expect(doc.account).toMatchObject({ email: 'admin@example.org', displayName: 'Ama Admin' });
    expect(doc.account.passwordHash).toBeUndefined();
    expect(doc.memberships[0]).toMatchObject({ family: 'Mensah Family', role: 'family_admin' });
    expect(doc.stories[0]).toMatchObject({ title: 'Sundays', family: 'Mensah Family' });
    expect(doc.sessions.length).toBeGreaterThan(0);
    expect(res.text).not.toMatch(/tokenHash|passwordHash/);
  });
});

describe('deleting an account', () => {
  it('requires the password, refuses to orphan a family, and erases personal data', async () => {
    const m = await member('m@example.org');
    await m.post(`/families/${familyId}/contributions`, { kind: 'member.update', targetId: kwame, payload: { hometown: 'Accra' } });
    expect((await m.post('/account/delete', { password: 'wrong password' })).status).toBe(400);

    const blocked = await admin.post('/account/delete', { password: TEST_PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('only administrator of Mensah Family');

    const res = await m.post('/account/delete', { password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toContain('fh_access=;');
    const gone = (await UserModel.findOne({ displayName: 'Former member' }))!;
    expect(gone).toMatchObject({ status: 'deleted', emailVerifiedAt: null });
    expect(gone.email).toMatch(/@deleted\.invalid$/);
    expect(await FamilyMembershipModel.countDocuments({ userId: gone._id, status: 'active' })).toBe(0);
    expect((await m.get('/auth/me')).status).toBe(401);
    const login = await (await new TestClient(ctx).init()).post('/auth/login', { email: 'm@example.org', password: TEST_PASSWORD });
    expect(login.status).toBe(401);
    // Their open suggestion was withdrawn; the address can be used for a new account.
    expect((await admin.get(`/families/${familyId}/contributions`)).body.data).toHaveLength(0);
    expect((await (await new TestClient(ctx).init()).post('/auth/register', { email: 'm@example.org', password: TEST_PASSWORD, displayName: 'New M' })).status).toBe(201);
  });
});

describe('deleting a family', () => {
  it('closes the family for a grace period, can be cancelled, then erases everything', async () => {
    const m = await member('m@example.org');
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#123' } }).png().toBuffer();
    const media = (await admin.upload(`/families/${familyId}/media`, { buffer: png, name: 'p.png' })).body.data;
    const stored = await FamilyMediaModel.findById(media.id);
    const file = path.join(ctx.env.MEDIA_LOCAL_DIR, stored!.storageKey);
    expect(existsSync(file)).toBe(true);

    expect((await m.post(`/families/${familyId}/deletion`, { name: 'Mensah Family', password: TEST_PASSWORD })).status).toBe(403);
    expect((await admin.post(`/families/${familyId}/deletion`, { name: 'Mensah family', password: TEST_PASSWORD })).status).toBe(400);
    expect((await admin.post(`/families/${familyId}/deletion`, { name: 'Mensah Family', password: 'nope' })).status).toBe(400);

    const scheduled = await admin.post(`/families/${familyId}/deletion`, { name: 'Mensah Family', password: TEST_PASSWORD });
    expect(scheduled.status).toBe(202);
    const when = new Date(scheduled.body.data.deletionScheduledFor).getTime();
    expect(when - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect((await admin.get(`/families/${familyId}`)).status).toBe(404);
    expect((await m.get(`/families/${familyId}/members`)).status).toBe(404);
    expect((await admin.get('/families')).body.data).toHaveLength(0);
    expect((await admin.get('/families/scheduled-deletions')).body.data).toEqual([{ id: familyId, name: 'Mensah Family', deletionScheduledFor: scheduled.body.data.deletionScheduledFor }]);
    expect((await m.delete(`/families/${familyId}/deletion`)).status).toBe(404);

    expect((await admin.delete(`/families/${familyId}/deletion`)).status).toBe(204);
    expect((await m.get(`/families/${familyId}/members`)).status).toBe(200);

    await admin.post(`/families/${familyId}/deletion`, { name: 'Mensah Family', password: TEST_PASSWORD });
    expect(await ctx.instance.lifecycle.purge(new Date())).toEqual({ families: 0, files: 0 });
    expect(await ctx.instance.lifecycle.purge(new Date(Date.now() + 31 * 86_400_000))).toEqual({ families: 1, files: 0 });
    expect(await FamilyModel.exists({ _id: familyId })).toBeNull();
    expect(await FamilyMemberModel.countDocuments({ familyId })).toBe(0);
    expect(await FamilyMembershipModel.countDocuments({ familyId })).toBe(0);
    expect(await FamilyMediaModel.countDocuments({ familyId })).toBe(0);
    expect(await AuditLogModel.countDocuments({ familyId })).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(await AuditLogModel.exists({ action: 'family.purge', targetId: familyId })).toBeTruthy();
  });
});

describe('removed files', () => {
  it('can be restored until the retention period ends, then are erased with their stored objects', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#456' } }).png().toBuffer();
    const media = (await admin.upload(`/families/${familyId}/media`, { buffer: png, name: 'q.png' })).body.data;
    const stored = (await FamilyMediaModel.findById(media.id))!;
    await admin.delete(`/families/${familyId}/media/${media.id}`);
    expect((await admin.get(`/families/${familyId}/trash/media`)).body.data.map((x: { id: string }) => x.id)).toEqual([media.id]);
    const m = await member('m@example.org');
    expect((await m.get(`/families/${familyId}/trash/media`)).status).toBe(403);
    expect((await admin.post(`/families/${familyId}/trash/media/${media.id}/restore`, {})).body.data.id).toBe(media.id);
    expect((await admin.get(`/families/${familyId}/media/${media.id}`)).status).toBe(200);

    await admin.delete(`/families/${familyId}/media/${media.id}`);
    expect((await ctx.instance.lifecycle.purge(new Date(Date.now() + 10 * 86_400_000))).files).toBe(0);
    expect((await ctx.instance.lifecycle.purge(new Date(Date.now() + 31 * 86_400_000))).files).toBe(1);
    expect(existsSync(path.join(ctx.env.MEDIA_LOCAL_DIR, stored.storageKey))).toBe(false);
    expect((await admin.post(`/families/${familyId}/trash/media/${media.id}/restore`, {})).status).toBe(404);
  });
});
