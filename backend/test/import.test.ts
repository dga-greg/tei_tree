import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeAnsel, decodeGedcom } from '../src/modules/import/gedcom-decode.js';
import { parseGedcom, parseGedcomDate } from '../src/modules/import/gedcom-parser.js';
import { buildImportPlan } from '../src/modules/import/import-plan.js';
import { scoreMatch } from '../src/modules/duplicates/match.js';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { FamilyMediaModel } from '../src/modules/media/media.model.js';
import { FamilyMemberModel } from '../src/modules/members/member.model.js';
import { RelationshipModel } from '../src/modules/relationships/relationship.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

const ged = (...lines: string[]) => Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');

describe('GEDCOM dates', () => {
  it('reads exact, partial, approximate and ranged dates', () => {
    expect(parseGedcomDate('12 MAR 1950')).toMatchObject({ year: 1950, month: 3, day: 12, qualifier: 'exact', sortKey: 19500312 });
    expect(parseGedcomDate('MAR 1950')).toMatchObject({ year: 1950, month: 3, qualifier: 'exact' });
    expect(parseGedcomDate('1950')).toMatchObject({ year: 1950, qualifier: 'exact' });
    expect(parseGedcomDate('ABT 1885')).toMatchObject({ year: 1885, qualifier: 'about' });
    expect(parseGedcomDate('CAL 1885')).toMatchObject({ year: 1885, qualifier: 'estimated' });
    expect(parseGedcomDate('EST 1885')).toMatchObject({ year: 1885, qualifier: 'estimated' });
    expect(parseGedcomDate('BEF 1900')).toMatchObject({ year: 1900, qualifier: 'before' });
    expect(parseGedcomDate('AFT 1900')).toMatchObject({ year: 1900, qualifier: 'after' });
    expect(parseGedcomDate('BET 1900 AND 1910')).toMatchObject({ year: 1900, endYear: 1910, qualifier: 'between' });
    expect(parseGedcomDate('FROM 1900 TO 1910')).toMatchObject({ year: 1900, endYear: 1910, qualifier: 'between' });
    expect(parseGedcomDate('@#DGREGORIAN@ 5 JUL 1901')).toMatchObject({ year: 1901, month: 7, day: 5 });
    expect(parseGedcomDate('INT 1890 (from the family bible)')).toMatchObject({ year: 1890, qualifier: 'exact' });
    // Old-style dual years take the later (modern) year.
    expect(parseGedcomDate('11 FEB 1731/32')).toMatchObject({ year: 1732, month: 2, day: 11 });
    expect(parseGedcomDate('1950-03-12')).toMatchObject({ year: 1950, month: 3, day: 12 });
  });

  it('keeps anything it cannot read as the wording of the date', () => {
    expect(parseGedcomDate('(the year of the great flood)')).toEqual({ qualifier: 'exact', text: 'the year of the great flood', sortKey: null });
    expect(parseGedcomDate('Spring after the war')).toMatchObject({ text: 'Spring after the war' });
    expect(parseGedcomDate('@#DHEBREW@ 5 TSH 5700')).toMatchObject({ text: '@#DHEBREW@ 5 TSH 5700' });
    expect(parseGedcomDate('44 BC')).toMatchObject({ text: '44 BC' });
    expect(parseGedcomDate('31 FEB 1900')).toMatchObject({ year: 1900, month: 2, qualifier: 'exact' });
    expect(parseGedcomDate('')).toBeNull();
  });
});

describe('GEDCOM character sets', () => {
  it('decodes ANSEL accents written before the letter', () => {
    expect(decodeAnsel(Buffer.from([0x4a, 0x6f, 0x73, 0xe2, 0x65]))).toBe('José');
    expect(decodeAnsel(Buffer.from([0x4b, 0xe8, 0x6f, 0x6e, 0x69, 0x67]))).toBe('König');
    expect(decodeAnsel(Buffer.from([0xa1, 0xf0, 0x63]))).toBe('Łç');
  });

  it('detects UTF-16, UTF-8 with a byte-order mark, ANSEL and Windows-1252 files', () => {
    const text = '0 HEAD\r\n1 CHAR UNICODE\r\n0 @I1@ INDI\r\n1 NAME Kwamé /Mensah/\r\n0 TRLR\r\n';
    expect(decodeGedcom(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])).text).toContain('Kwamé');
    expect(decodeGedcom(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])).text).toContain('Kwamé');
    const ansel = Buffer.concat([Buffer.from('0 HEAD\r\n1 CHAR ANSEL\r\n0 @I1@ INDI\r\n1 NAME Kwam'), Buffer.from([0xe2, 0x65]), Buffer.from(' /Mensah/\r\n')]);
    expect(decodeGedcom(ansel)).toMatchObject({ charset: 'ANSEL' });
    expect(decodeGedcom(ansel).text).toContain('Kwamé');
    const ansi = Buffer.concat([Buffer.from('0 HEAD\r\n1 CHAR ANSI\r\n0 @I1@ INDI\r\n1 NAME Kwam'), Buffer.from([0xe9]), Buffer.from(' /Mensah/\r\n')]);
    expect(decodeGedcom(ansi).text).toContain('Kwamé');
  });
});

describe('GEDCOM files from different programs', () => {
  it('reads an Ancestry / Family Tree Maker style file', () => {
    const parsed = parseGedcom(
      ged(
        '0 HEAD', '1 SOUR Ancestry.com Family Trees', '2 NAME Ancestry.com Member Trees', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Kofi /Mensah/', '2 GIVN Kofi', '2 SURN Mensah', '1 SEX M', '1 BIRT', '2 DATE ABT 1885', '2 PLAC Cape Coast, Central, Gold Coast', '1 DEAT', '2 DATE 1962', '1 OCCU Cocoa farmer',
        '1 SOUR @S1@', '2 PAGE Page 12', '1 NOTE Founder of the farm.', '2 CONT He planted the first trees in 1910', '2 CONC  near the river.',
        '0 @I2@ INDI', '1 NAME Akosua /Mensah/', '1 NAME Akosua /Owusu/', '2 TYPE birth', '1 SEX F', '1 DEAT Y',
        '0 @I3@ INDI', '1 NAME Kwame Kofi /Mensah/', '1 SEX M', '1 BIRT', '2 DATE 12 MAR 1950', '1 FAMC @F1@',
        '0 @I4@ INDI', '1 NAME Yaw /Mensah/', '1 SEX M', '1 BIRT', '2 DATE 1955',
        '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 MARR', '2 DATE 1910', '2 TYPE Customary', '1 CHIL @I3@', '1 CHIL @I4@', '2 _FREL Natural', '2 _MREL Adopted',
        '0 @S1@ SOUR', '1 TITL Ghana, Births and Baptisms', '0 TRLR',
      ),
    );
    expect(parsed.source).toMatchObject({ system: 'Ancestry.com Member Trees', version: '5.5.1', charset: 'UTF-8' });
    const kofi = parsed.people.find((p) => p.ref === 'I1')!;
    expect(kofi).toMatchObject({ firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthPlace: 'Cape Coast, Central, Gold Coast' });
    expect(kofi.birthDate).toMatchObject({ year: 1885, qualifier: 'about' });
    expect(kofi.occupations).toEqual([{ title: 'Cocoa farmer', from: null }]);
    expect(kofi.sources).toEqual([{ title: 'Ghana, Births and Baptisms', citation: 'Page 12' }]);
    expect(kofi.biography).toBe('Founder of the farm.\nHe planted the first trees in 1910 near the river.');
    expect(parsed.people.find((p) => p.ref === 'I2')).toMatchObject({ maidenName: 'Owusu', vitalStatus: 'deceased' });
    expect(parsed.people.find((p) => p.ref === 'I3')).toMatchObject({ firstName: 'Kwame', middleNames: 'Kofi', vitalStatus: 'living' });
    expect(parsed.partnerships).toEqual([{ a: 'I1', b: 'I2', subtype: 'customary_marriage', status: 'current', startDate: expect.objectContaining({ year: 1910 }), endDate: null }]);
    expect(parsed.parentLinks).toEqual([
      { parent: 'I1', child: 'I3', subtype: 'biological' },
      { parent: 'I2', child: 'I3', subtype: 'biological' },
      { parent: 'I1', child: 'I4', subtype: 'biological' },
      { parent: 'I2', child: 'I4', subtype: 'adoptive' },
    ]);
  });

  it('reads a Gramps / FamilySearch style file with PEDI, divorces, burials and FAMC-only children', () => {
    const parsed = parseGedcom(
      ged(
        '0 HEAD', '1 SOUR Gramps', '2 VERS 5.2', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I0001@ INDI', '1 NAME Ama /Boateng/', '2 NICK Maame', '2 NPFX Madam', '1 SEX F', '1 BURI', '2 DATE 3 JAN 1971', '2 PLAC Kumasi', '1 _MARNM Asante',
        '0 @I0002@ INDI', '1 NAME Kojo /Asante/', '1 SEX M', '1 CHR', '2 DATE 4 JUN 1921',
        '0 @I0003@ INDI', '1 NAME Efua /Asante/', '1 SEX F', '1 FAMC @F0001@', '2 PEDI foster',
        '0 @F0001@ FAM', '1 HUSB @I0002@', '1 WIFE @I0001@', '1 MARR', '1 DIV', '2 DATE 1960',
        '0 TRLR',
      ),
    );
    const ama = parsed.people.find((p) => p.ref === 'I0001')!;
    expect(ama).toMatchObject({ preferredName: 'Maame', title: 'Madam', vitalStatus: 'deceased', deathPlace: 'Kumasi', previousNames: ['Ama Asante'] });
    // A burial stands in for the death date, approximately.
    expect(ama.deathDate).toMatchObject({ year: 1971, qualifier: 'about' });
    expect(parsed.people.find((p) => p.ref === 'I0002')!.birthDate).toMatchObject({ year: 1921, qualifier: 'about' });
    expect(parsed.partnerships[0]).toMatchObject({ subtype: 'marriage', status: 'divorced', endDate: expect.objectContaining({ year: 1960 }) });
    expect(parsed.parentLinks).toEqual([
      { parent: 'I0002', child: 'I0003', subtype: 'foster' },
      { parent: 'I0001', child: 'I0003', subtype: 'foster' },
    ]);
  });

  it('warns about problems instead of failing', () => {
    const parsed = parseGedcom(
      ged('0 HEAD', '1 CHAR UTF-8', '0 @I1@ INDI', '1 NAME /Mensah/', 'garbage line', '0 @I1@ INDI', '1 NAME Second /Copy/', '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I9@', '1 CHIL @I8@', '0 TRLR'),
    );
    expect(parsed.people).toHaveLength(1);
    expect(parsed.people[0]).toMatchObject({ firstName: 'Unknown', surname: 'Mensah' });
    const messages = parsed.warnings.map((w) => w.message).join('\n');
    expect(messages).toContain('Has no first name');
    expect(messages).toContain('used twice');
    expect(messages).toContain('not in the file');
  });
});

describe('import plan', () => {
  const person = (ref: string) => ({ ref, firstName: ref, middleNames: '', surname: '', maidenName: '', preferredName: '', title: '', previousNames: [], gender: null, vitalStatus: 'unknown' as const, birthDate: null, birthPlace: '', deathDate: null, deathPlace: '', nationality: '', occupations: [], education: [], biography: '', sources: [] });
  const base = { source: { system: '', version: '', charset: '' }, families: 0, warnings: [] };

  it('applies the integrity rules to the file and the family together', () => {
    const plan = buildImportPlan(
      {
        ...base,
        people: ['A', 'B', 'C', 'D'].map(person),
        parentLinks: [
          { parent: 'A', child: 'C', subtype: 'biological' },
          { parent: 'B', child: 'C', subtype: 'biological' },
          { parent: 'D', child: 'C', subtype: 'biological' },
          { parent: 'C', child: 'A', subtype: 'biological' },
          { parent: 'A', child: 'C', subtype: 'biological' },
        ],
        partnerships: [
          { a: 'A', b: 'B', subtype: 'marriage', status: 'current', startDate: null, endDate: null },
          { a: 'B', b: 'C', subtype: 'marriage', status: 'current', startDate: null, endDate: null },
        ],
      },
      { parentLinks: [], partnerships: [] },
      new Map(),
    );
    // A third birth parent becomes "unknown"; the cycle A→C→A is dropped; B–C cannot be both.
    expect(plan.parentLinks.find((l) => l.parent === 'new:D')?.subtype).toBe('unknown');
    expect(plan.parentLinks.some((l) => l.parent === 'new:C' && l.child === 'new:A')).toBe(false);
    expect(plan.partnerships.map((p) => [p.a, p.b])).toEqual([['new:A', 'new:B']]);
    expect(plan.warnings.map((w) => w.message).join('\n')).toMatch(/more than two birth parents[\s\S]*own ancestor[\s\S]*parent and child/);
  });

  it('skips links the family already has, using the chosen matches', () => {
    const plan = buildImportPlan(
      { ...base, people: ['A', 'C'].map(person), parentLinks: [{ parent: 'A', child: 'C', subtype: 'biological' }], partnerships: [] },
      { parentLinks: [{ parent: 'm1', child: 'm2', subtype: 'biological' }], partnerships: [] },
      new Map([['A', 'm1'], ['C', 'm2']]),
    );
    expect(plan.create).toHaveLength(0);
    expect(plan.parentLinks).toHaveLength(0);
    expect(plan.skipped).toBe(1);
  });
});

describe('matching people', () => {
  it('scores names, spellings and dates', () => {
    const kwame = { id: 'a', firstName: 'Kwame', surname: 'Mensah', gender: 'male', birthDate: { year: 1950, month: 3, day: 12 } };
    expect(scoreMatch(kwame, { id: 'b', firstName: 'Kwame', surname: 'Mensah', gender: 'male', birthDate: { year: 1950, month: 3, day: 12 } })).toMatchObject({ strength: 'strong', reasons: ['Same first name', 'Same surname', 'Same date of birth'] });
    expect(scoreMatch(kwame, { id: 'b', firstName: 'Quame', surname: 'Mensa', birthDate: { year: 1951 } })?.strength).toBe('possible');
    expect(scoreMatch(kwame, { id: 'b', firstName: 'Kwame', surname: 'Mensah', birthDate: { year: 1990 } })).toBeNull();
    expect(scoreMatch(kwame, { id: 'b', firstName: 'Kwame', surname: 'Mensah', gender: 'female' })).toBeNull();
    expect(scoreMatch(kwame, { id: 'b', firstName: 'Yaw', surname: 'Mensah', birthDate: { year: 1950 } })).toBeNull();
  });
});

// ------------------------------------------------------------------ through the API

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let kofi: string;

async function member(email: string, role = 'family_member'): Promise<TestClient> {
  const client = await registeredClient(ctx, email, email.split('@')[0]);
  await UserModel.updateOne({ email }, { emailVerifiedAt: new Date() });
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role });
  return client;
}

async function newFamily(name: string, founder: Record<string, unknown>) {
  const res = await admin.post('/families', { name, founder });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data as { id: string; foundingMemberId: string };
}

/** Parent/child and partner links of a family, by first name, for comparing families. */
async function shape(id: string) {
  const people = await FamilyMemberModel.find({ familyId: id, deletedAt: null });
  const name = new Map(people.map((p) => [p.id as string, p.firstName]));
  const edges = await RelationshipModel.find({ familyId: id, deletedAt: null });
  return {
    people: people.map((p) => p.firstName).sort(),
    parents: edges.filter((e) => e.type === 'parent_child').map((e) => `${name.get(e.personA.toString())}>${name.get(e.personB.toString())}:${e.subtype}`).sort(),
    partners: edges.filter((e) => e.type === 'partnership').map((e) => [name.get(e.personA.toString()), name.get(e.personB.toString())].sort().join('+') + `:${e.subtype}`).sort(),
  };
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
  const fam = await newFamily('Mensah Family', { firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1885, qualifier: 'about' } });
  familyId = fam.id;
  kofi = fam.foundingMemberId;
});

describe('GEDCOM import', () => {
  it('round-trips: a family exported and imported elsewhere has the same people and links', async () => {
    const akosua = await addPerson(admin, familyId, { firstName: 'Akosua', surname: 'Mensah', maidenName: 'Owusu', gender: 'female', vitalStatus: 'deceased' }, { partners: [{ memberId: kofi, subtype: 'customary_marriage', verification: 'verified' }] });
    const kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', gender: 'male', vitalStatus: 'living', birthDate: { year: 1950, month: 3, day: 12 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }, { memberId: akosua, subtype: 'biological', verification: 'verified' }] });
    await addPerson(admin, familyId, { firstName: 'Esi', surname: 'Mensah', gender: 'female', vitalStatus: 'living', birthDate: { year: 1980 } }, { parents: [{ memberId: kwame, subtype: 'adoptive', verification: 'verified' }] });
    const file = Buffer.from((await admin.get(`/families/${familyId}/export?format=gedcom`)).text, 'utf8');

    const target = await newFamily('Mensah Copy', { firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1885, qualifier: 'about' } });
    const preview = await admin.upload(`/families/${target.id}/import/gedcom/preview`, { buffer: file, name: 'mensah.ged' });
    expect(preview.status).toBe(200);
    expect(preview.body.data.counts).toMatchObject({ people: 4, parentLinks: 3, partnerships: 1 });
    const match = preview.body.data.matches.find((m: { existing: { id: string } }) => m.existing.id === target.foundingMemberId);
    expect(match).toMatchObject({ strength: 'strong', person: { name: 'Kofi Mensah' } });

    const done = await admin.upload(`/families/${target.id}/import/gedcom`, { buffer: file, name: 'mensah.ged' }, { decisions: { same: { [match.person.ref]: target.foundingMemberId }, fillBlanks: true } });
    expect(done.status).toBe(201);
    expect(done.body.data).toMatchObject({ status: 'active', counts: { created: 3, matched: 1, parentLinks: 3, partnerships: 1 }, createdBy: 'Ama Admin' });
    expect(await shape(target.id)).toEqual(await shape(familyId));
    const esi = await FamilyMemberModel.findOne({ familyId: target.id, firstName: 'Esi' });
    expect(esi).toMatchObject({ vitalStatus: 'living', surname: 'Mensah' });
    expect(esi!.searchTokens).toContain('es');
    expect((await FamilyMemberModel.findOne({ familyId: target.id, firstName: 'Akosua' }))!.maidenName).toBe('Owusu');
    // Generations are worked out for the imported people.
    await new Promise((r) => setTimeout(r, 300));
    const gens = await FamilyMemberModel.find({ familyId: target.id }, { firstName: 1, 'generation.number': 1 }).lean();
    expect(Object.fromEntries(gens.map((g) => [g.firstName, g.generation?.number]))).toMatchObject({ Kofi: 1, Kwame: 2 });
    expect(await AuditLogModel.countDocuments({ familyId: target.id, action: 'import.commit' })).toBe(1);
  });

  it('fills in empty details of matched people, and undoing puts everything back', async () => {
    const file = ged(
      '0 HEAD', '1 CHAR UTF-8',
      '0 @I1@ INDI', '1 NAME Kofi /Mensah/', '1 SEX M', '1 BIRT', '2 DATE ABT 1885', '2 PLAC Cape Coast', '1 DEAT', '2 DATE 1962',
      '0 @I2@ INDI', '1 NAME Yaw /Mensah/', '1 SEX M', '1 BIRT', '2 DATE 1930', '1 FAMC @F1@',
      '0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @I2@', '0 TRLR',
    );
    const done = (await admin.upload(`/families/${familyId}/import/gedcom`, { buffer: file, name: 'more.ged' }, { decisions: { same: { I1: kofi }, fillBlanks: true } })).body.data;
    expect(done.counts).toMatchObject({ created: 1, matched: 1, filled: 1, parentLinks: 1 });
    const filled = await FamilyMemberModel.findById(kofi);
    expect(filled).toMatchObject({ birthPlace: 'Cape Coast' });
    expect(filled!.deathDate).toMatchObject({ year: 1962 });

    expect((await admin.get(`/families/${familyId}/imports`)).body.data).toHaveLength(1);
    const undo = await admin.post(`/families/${familyId}/imports/${done.id}/undo`);
    expect(undo.status).toBe(200);
    expect(undo.body.data.status).toBe('undone');
    expect(await FamilyMemberModel.countDocuments({ familyId, deletedAt: null })).toBe(1);
    expect(await RelationshipModel.countDocuments({ familyId, deletedAt: null })).toBe(0);
    const restored = await FamilyMemberModel.findById(kofi);
    expect(restored!.birthPlace).toBe('');
    expect(restored!.deathDate).toBeNull();
    expect((await admin.post(`/families/${familyId}/imports/${done.id}/undo`)).status).toBe(409);
  });

  it('is for administrators, and only for GEDCOM files', async () => {
    const m = await member('m@example.org');
    const file = ged('0 HEAD', '0 @I1@ INDI', '1 NAME A /B/', '0 TRLR');
    expect((await m.upload(`/families/${familyId}/import/gedcom/preview`, { buffer: file, name: 'a.ged' })).status).toBe(403);
    expect((await m.get(`/families/${familyId}/imports`)).status).toBe(403);
    const notGedcom = await admin.upload(`/families/${familyId}/import/gedcom/preview`, { buffer: Buffer.from('name,born\nKofi,1885\n'), name: 'people.csv' });
    expect(notGedcom.status).toBe(415);
    const empty = await admin.upload(`/families/${familyId}/import/gedcom/preview`, { buffer: ged('0 HEAD', '0 TRLR'), name: 'empty.ged' });
    expect(empty.status).toBe(400);
    const bad = await admin.upload(`/families/${familyId}/import/gedcom`, { buffer: file, name: 'a.ged' }, { decisions: { same: { I9: kofi } } });
    expect(bad.status).toBe(400);
  });
});

describe('duplicates and merging', () => {
  it('finds likely duplicates, and forgets pairs marked as different people', async () => {
    const a = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', gender: 'male', birthDate: { year: 1950 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
    const b = await addPerson(admin, familyId, { firstName: 'Quame', surname: 'Mensa', gender: 'male', birthDate: { year: 1950 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
    await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', gender: 'male', birthDate: { year: 1990 } });
    const list = (await admin.get(`/families/${familyId}/duplicates`)).body.data;
    expect(list).toHaveLength(1);
    expect([list[0].a.id, list[0].b.id].sort()).toEqual([a, b].sort());
    expect(list[0].reasons).toEqual(expect.arrayContaining(['First names sound alike', 'Born the same year', 'Same parent']));
    expect((await admin.post(`/families/${familyId}/duplicates/dismiss`, { a: b, b: a })).status).toBe(204);
    expect((await admin.get(`/families/${familyId}/duplicates`)).body.data).toHaveLength(0);
    const m = await member('m@example.org');
    expect((await m.get(`/families/${familyId}/duplicates`)).status).toBe(403);
  });

  it('merges two people, moving links, tags and claims, and can be undone', async () => {
    const keep = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', gender: 'male', birthDate: { year: 1950 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
    const other = await addPerson(admin, familyId, { firstName: 'Kwame', middleNames: 'Kofi', surname: 'Mensah', birthPlace: 'Accra', occupations: [{ title: 'Teacher' }], birthDate: { year: 1950, month: 3, day: 12 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
    const child = await addPerson(admin, familyId, { firstName: 'Esi', surname: 'Mensah' }, { parents: [{ memberId: other, subtype: 'biological', verification: 'verified' }] });
    const media = await FamilyMediaModel.create({ familyId, kind: 'photo', title: 'Wedding', storageKey: 'k', mimeType: 'image/png', byteSize: 1, sha256: 'x', originalName: 'a.png', memberIds: [other], uploadedBy: (await UserModel.findOne())!._id, status: 'published', privacy: 'family', searchText: 'wedding' });
    const m = await member('kwame@example.org');
    await FamilyMembershipModel.updateOne({ userId: (await UserModel.findOne({ email: 'kwame@example.org' }))!._id }, { memberProfileId: other });

    const versions = async () => [(await FamilyMemberModel.findById(keep))!.get('version'), (await FamilyMemberModel.findById(other))!.get('version')];
    const [kv, ov] = await versions();
    expect((await admin.post(`/families/${familyId}/members/${keep}/merge`, { otherId: other, choices: {}, keepVersion: kv + 1, otherVersion: ov })).status).toBe(409);
    expect((await m.post(`/families/${familyId}/members/${keep}/merge`, { otherId: other, choices: {}, keepVersion: kv, otherVersion: ov })).status).toBe(403);

    const res = await admin.post(`/families/${familyId}/members/${keep}/merge`, { otherId: other, choices: { birthDate: 'other', birthPlace: 'other', middleNames: 'other' }, keepVersion: kv, otherVersion: ov });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ otherName: 'Kwame Mensah', linksMoved: 1, linksDropped: 1, itemsMoved: 1 });
    const merged = await FamilyMemberModel.findById(keep);
    expect(merged).toMatchObject({ middleNames: 'Kofi', birthPlace: 'Accra' });
    expect(merged!.birthDate).toMatchObject({ year: 1950, month: 3, day: 12 });
    expect(merged!.occupations.map((o) => o.title)).toEqual(['Teacher']);
    expect(await RelationshipModel.exists({ familyId, personA: keep, personB: child, deletedAt: null })).toBeTruthy();
    expect(await RelationshipModel.countDocuments({ familyId, personB: keep, deletedAt: null })).toBe(1);
    expect((await FamilyMediaModel.findById(media._id))!.memberIds.map(String)).toEqual([keep]);
    expect((await FamilyMembershipModel.findOne({ memberProfileId: keep }))).toBeTruthy();
    expect((await admin.get(`/families/${familyId}/members/${other}`)).status).toBe(404);
    expect((await admin.get(`/families/${familyId}/trash/members`)).body.data).toHaveLength(0);
    expect((await admin.post(`/families/${familyId}/trash/members/${other}/restore`)).status).toBe(409);

    const undo = await admin.post(`/families/${familyId}/merges/${res.body.data.id}/undo`);
    expect(undo.status).toBe(200);
    const back = await FamilyMemberModel.findById(keep);
    expect(back).toMatchObject({ middleNames: '', birthPlace: '' });
    expect(back!.occupations).toHaveLength(0);
    expect((await FamilyMemberModel.findById(other))).toMatchObject({ deletedAt: null, mergedInto: null });
    expect(await RelationshipModel.exists({ familyId, personA: other, personB: child, deletedAt: null })).toBeTruthy();
    expect(await RelationshipModel.countDocuments({ familyId, personB: { $in: [keep, other] }, personA: kofi, deletedAt: null })).toBe(2);
    expect((await FamilyMediaModel.findById(media._id))!.memberIds.map(String)).toEqual([other]);
    expect((await FamilyMembershipModel.findOne({ memberProfileId: other }))).toBeTruthy();
    expect((await admin.post(`/families/${familyId}/merges/${res.body.data.id}/undo`)).status).toBe(409);
  });

  it('refuses a merge that would break a family rule', async () => {
    const mother = await addPerson(admin, familyId, { firstName: 'Ama', surname: 'Mensah', gender: 'female' });
    const other = await addPerson(admin, familyId, { firstName: 'Abena', surname: 'Owusu', gender: 'female' });
    const a = await addPerson(admin, familyId, { firstName: 'Yaw', surname: 'Mensah' }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }, { memberId: mother, subtype: 'biological', verification: 'verified' }] });
    const b = await addPerson(admin, familyId, { firstName: 'Yaw', surname: 'Mensah' }, { parents: [{ memberId: other, subtype: 'biological', verification: 'verified' }] });
    const [kv, ov] = [(await FamilyMemberModel.findById(a))!.get('version'), (await FamilyMemberModel.findById(b))!.get('version')];
    const res = await admin.post(`/families/${familyId}/members/${a}/merge`, { otherId: b, choices: {}, keepVersion: kv, otherVersion: ov });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('3 birth parents');
    // Nothing changed.
    expect(await FamilyMemberModel.countDocuments({ familyId, deletedAt: null })).toBe(5);
    expect(await RelationshipModel.countDocuments({ familyId, personB: b, deletedAt: null })).toBe(1);
  });
});
