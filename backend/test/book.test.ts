import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BOOK_LABELS } from '@fh/contracts';
import { assembleBook, bookDate, bookLabels } from '../src/modules/book/book.data.js';
import { FamilyBookModel } from '../src/modules/book/book.model.js';
import { renderBook } from '../src/modules/book/book.render.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { resolveFamilyAccess } from '../src/modules/families/family-access.js';
import { FamilyMemberModel } from '../src/modules/members/member.model.js';
import { RelationshipModel } from '../src/modules/relationships/relationship.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { LocalStorage } from '../src/infra/storage.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

const png = (color = '#3a3') => sharp({ create: { width: 60, height: 40, channels: 4, background: color } }).png().toBuffer();
const options = (extra: Record<string, unknown> = {}) => ({
  scope: 'family' as const,
  include: { tree: true, people: true, stories: true, timeline: true, photos: true },
  living: 'names' as const,
  paper: 'A4' as const,
  ...extra,
});

describe('book dates and labels', () => {
  it('formats fuzzy dates in the book language', () => {
    const labels = bookLabels({ about: 'vers {date}' });
    expect(bookDate({ year: 1950, month: 3, day: 12, qualifier: 'exact' }, 'en-GB', labels)).toBe('12 March 1950');
    expect(bookDate({ year: 1950, month: 3, day: 12, qualifier: 'exact' }, 'fr', labels)).toBe('12 mars 1950');
    expect(bookDate({ year: 1885, qualifier: 'about' }, 'fr', labels)).toBe('vers 1885');
    expect(bookDate({ year: 1900, endYear: 1910, qualifier: 'between' }, 'en', labels)).toBe('between 1900 and 1910');
    expect(bookDate(null, 'en', labels)).toBe('');
    // Blank translations fall back to the English.
    expect(bookLabels({ people: '  ' }).people).toBe(BOOK_LABELS.people);
    // So do translations that lost a placeholder (the name, date or number would go missing).
    expect(bookLabels({ descendantsOf: 'Les descendants de ' }).descendantsOf).toBe(BOOK_LABELS.descendantsOf);
    expect(bookLabels({ page: 'Page' }).page).toBe(BOOK_LABELS.page);
    expect(bookLabels({ page: 'Page {number}', bornEvent: 'Naissance de {name}' })).toMatchObject({ page: 'Page {number}', bornEvent: 'Naissance de {name}' });
  });
});

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let kofi: string;
let kwame: string;
let esi: string;

async function member(email: string): Promise<TestClient> {
  const client = await registeredClient(ctx, email, email.split('@')[0]);
  await UserModel.updateOne({ email }, { emailVerifiedAt: new Date() });
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role: 'family_member' });
  return client;
}

async function accessFor(email: string) {
  return (await resolveFamilyAccess(new Types.ObjectId(familyId), (await UserModel.findOne({ email }))!._id))!;
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
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1885, qualifier: 'about' }, deathDate: { year: 1962 }, birthPlace: 'Kumasi', biography: 'Cocoa farmer who walked from the coast.' } })).body.data;
  familyId = fam.id;
  kofi = fam.foundingMemberId;
  kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1912 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
  esi = await addPerson(admin, familyId, { firstName: 'Ɛsi', surname: 'Mensah', gender: 'female', vitalStatus: 'living', birthDate: { year: 1960, month: 5, day: 1 }, birthPlace: 'Accra', biography: 'Teacher.' }, { parents: [{ memberId: kwame, subtype: 'biological', verification: 'verified' }] });
});

describe('family books', () => {
  it('makes a whole-family book with photos, stories and a timeline, and lets its maker download it', async () => {
    const photo = (await admin.upload(`/families/${familyId}/media`, { buffer: await png(), name: 'farm.png' }, { memberIds: [kofi], title: 'The farm' })).body.data;
    await admin.patch(`/families/${familyId}/members/${kofi}`, { profilePhotoMediaId: photo.id, version: (await admin.get(`/families/${familyId}/members/${kofi}`)).body.data.version });
    await admin.post(`/families/${familyId}/stories`, { kind: 'oral_history', title: 'How Kofi came to Kumasi', body: 'He walked from the coast.\n\nHe planted cocoa.', narrator: 'Nana Akua', memberIds: [kofi] });
    await admin.post(`/families/${familyId}/events`, { kind: 'migration', title: 'The move to Kumasi', date: { year: 1905 }, place: 'Kumasi', memberIds: [kofi] });

    const res = await admin.post(`/families/${familyId}/books`, { ...options(), locale: 'fr', labels: { people: 'Personnes', contents: 'Sommaire' } });
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ title: 'Mensah Family', status: 'queued', downloadUrl: null });
    await ctx.instance.books.idle();
    const done = (await admin.get(`/families/${familyId}/books/${res.body.data.id}`)).body.data;
    expect(done).toMatchObject({ status: 'done', progress: 100, people: 3, error: null });
    // Cover, contents, tree, people, stories, timeline, photos, index.
    expect(done.pages).toBeGreaterThanOrEqual(8);
    expect(done.downloadUrl).toBe(`/api/v1/families/${familyId}/books/${done.id}/download`);

    const dl = await admin.get(`/families/${familyId}/books/${done.id}/download`);
    expect(dl.status).toBe(302);
    const file = await admin.agent.get(new URL(dl.headers['location'] as string, 'http://x').pathname + new URL(dl.headers['location'] as string, 'http://x').search).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(file.body).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await admin.get(`/families/${familyId}/books`)).body.data).toHaveLength(1);
  });

  it('shows only names of living people unless asked, and follows what the maker may see', async () => {
    const data = await assembleBook(await accessFor('admin@example.org'), options(), new LocalStorage(join(tmpdir(), 'fh-book-test'), 'test-secret', 60));
    const esiPage = data.people.find((p) => p.id === esi)!;
    expect(esiPage).toMatchObject({ name: 'Ɛsi Mensah', born: '', biography: '', lifespan: '' });
    expect(data.livingNote).toBe(true);
    expect(data.people.map((p) => p.id)).toEqual([kofi, kwame, esi]);
    expect(data.people.find((p) => p.id === kofi)).toMatchObject({ born: 'about 1885, Kumasi', lifespan: 'about 1885 – 1962', children: [kwame], biography: 'Cocoa farmer who walked from the coast.' });
    expect(data.timeline.map((e) => e.text)).toEqual(['Kofi Mensah was born — Kumasi', 'Kwame Mensah was born', 'Kofi Mensah died']);
    const full = await assembleBook(await accessFor('admin@example.org'), options({ living: 'full', locale: 'en-GB' }), new LocalStorage(join(tmpdir(), 'fh-book-test'), 'test-secret', 60));
    expect(full.people.find((p) => p.id === esi)).toMatchObject({ born: '1 May 1960, Accra', biography: 'Teacher.' });
    expect(full.livingNote).toBe(false);
  });

  it('makes books of a branch and of one person', async () => {
    const ama = await addPerson(admin, familyId, { firstName: 'Ama', surname: 'Mensah', gender: 'female', vitalStatus: 'deceased' }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
    const spouse = await addPerson(admin, familyId, { firstName: 'Yaa', surname: 'Owusu', gender: 'female', vitalStatus: 'deceased' }, { partners: [{ memberId: kwame, subtype: 'marriage', verification: 'verified' }] });
    const branch = (await admin.post(`/families/${familyId}/branches`, { name: 'House of Kwame', foundingMemberId: kwame })).body.data;
    const access = await accessFor('admin@example.org');
    const storage = new LocalStorage(join(tmpdir(), 'fh-book-test'), 'test-secret', 60);
    const b = await assembleBook(access, options({ scope: 'branch', branchId: branch.id }), storage);
    expect(b.title).toBe('House of Kwame');
    expect(b.subtitle).toBe('The descendants of Kwame Mensah');
    expect(b.people.map((p) => p.id).sort()).toEqual([kwame, spouse, esi].sort());
    const p = await assembleBook(access, options({ scope: 'person', personId: esi, generations: 1 }), storage);
    expect(p.rootId).toBe(kwame);
    expect(p.people.map((x) => x.id).sort()).toEqual([kwame, spouse, esi].sort());
    expect(p.subtitle).toBe('The family of Kwame Mensah');
    const deep = await assembleBook(access, options({ scope: 'person', personId: esi, generations: 2 }), storage);
    expect(deep.people.map((x) => x.id)).not.toContain(ama);
    expect(deep.rootId).toBe(kofi);
  });

  it('keeps each book to its maker and checks requests', async () => {
    const m = await member('m@example.org');
    expect((await m.post(`/families/${familyId}/books`, { ...options(), scope: 'branch' })).status).toBe(400);
    expect((await m.post(`/families/${familyId}/books`, { ...options(), scope: 'person', personId: new Types.ObjectId().toString() })).status).toBe(404);
    expect((await m.post(`/families/${familyId}/books`, { ...options(), labels: { nonsense: 'x' } })).status).toBe(400);
    const mine = (await m.post(`/families/${familyId}/books`, options())).body.data;
    await ctx.instance.books.idle();
    expect((await admin.get(`/families/${familyId}/books/${mine.id}`)).status).toBe(404);
    expect((await admin.get(`/families/${familyId}/books/${mine.id}/download`)).status).toBe(404);
    expect((await admin.get(`/families/${familyId}/books`)).body.data).toHaveLength(0);
    const guest = await registeredClient(ctx, 'guest@example.org');
    expect((await guest.post(`/families/${familyId}/books`, options())).status).toBeGreaterThanOrEqual(403);

    // One at a time.
    await FamilyBookModel.create({ familyId, requestedBy: (await UserModel.findOne({ email: 'm@example.org' }))!._id, title: 'x', options: options(), status: 'running' });
    expect((await m.post(`/families/${familyId}/books`, options())).status).toBe(409);

    expect((await m.delete(`/families/${familyId}/books/${mine.id}`)).status).toBe(204);
    expect((await m.get(`/families/${familyId}/books/${mine.id}`)).status).toBe(404);
  });

  it('records why a book could not be made', async () => {
    const res = await admin.post(`/families/${familyId}/books`, options({ scope: 'person', personId: esi }));
    await FamilyMemberModel.updateOne({ _id: esi }, { deletedAt: new Date() });
    await ctx.instance.books.idle();
    const book = (await admin.get(`/families/${familyId}/books/${res.body.data.id}`)).body.data;
    expect(book.status === 'failed' ? book.error : 'done').toMatch(/done|hidden|not in the family/);
  });
});

describe('a large family', () => {
  it('lays out a 500-person book in reasonable time', async () => {
    const userId = (await UserModel.findOne())!._id;
    const fam = new Types.ObjectId(familyId);
    // Five generations: each person has up to four children, until 500 people.
    const people = [{ _id: new Types.ObjectId(kofi), gen: 1 }];
    const docs: Record<string, unknown>[] = [];
    const edges: Record<string, unknown>[] = [];
    for (let i = 0; people.length < 500; i++) {
      const parent = people[i]!;
      for (let c = 0; c < 4 && people.length < 500; c++) {
        const _id = new Types.ObjectId();
        people.push({ _id, gen: parent.gen + 1 });
        docs.push({ _id, familyId: fam, firstName: `Child${people.length}`, surname: 'Mensah', vitalStatus: 'deceased', birthDate: { year: 1885 + parent.gen * 25 + c, sortKey: (1885 + parent.gen * 25 + c) * 10000 }, birthPlace: 'Kumasi', biography: 'A life remembered by the family. '.repeat(6), generation: { number: parent.gen + 1, status: 'computed' }, createdBy: userId });
        edges.push({ familyId: fam, type: 'parent_child', subtype: 'biological', personA: parent._id, personB: _id, verification: 'verified', createdBy: userId });
      }
    }
    await FamilyMemberModel.insertMany(docs);
    await RelationshipModel.insertMany(edges);
    const started = Date.now();
    const data = await assembleBook(await accessFor('admin@example.org'), options(), new LocalStorage(join(tmpdir(), 'fh-book-test'), 'test-secret', 60));
    expect(data.people).toHaveLength(500 + 2);
    const file = join(tmpdir(), `fh-book-${Date.now()}.pdf`);
    const { pages } = await renderBook(data, file);
    const elapsed = Date.now() - started;
    // People share pages now; the tree continues over many charts.
    expect(pages).toBeGreaterThan(100);
    expect((await readFile(file)).subarray(0, 5).toString()).toBe('%PDF-');
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);
});
