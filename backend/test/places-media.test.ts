import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { FamilyMediaModel } from '../src/modules/media/media.model.js';
import { mediaSearchText } from '../src/modules/media/transcription.service.js';
import { PlaceMatcher, placeKey, suggestedName, textKeys } from '../src/modules/places/places.match.js';
import { UserModel } from '../src/modules/users/user.model.js';
import type { Transcriber } from '../src/infra/transcriber.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

const png = (color = '#3a3') => sharp({ create: { width: 30, height: 20, channels: 4, background: color } }).png().toBuffer();
const mp3 = () => Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x0a' + '\0'.repeat(10) + '\xff\xfb\x90\x00' + '\0'.repeat(4000), 'latin1');

describe('place matching', () => {
  it('normalises names and matches free text by its whole value or its first part', () => {
    expect(placeKey('  Kumásí  (Ashanti) ')).toBe('kumasi ashanti');
    expect(textKeys('Kumasi, Ashanti, Ghana')).toEqual(['kumasi ashanti ghana', 'kumasi']);
    expect(textKeys('  ')).toEqual([]);
    expect(suggestedName('  Cape   Coast , Central')).toBe('Cape Coast');
    const m = new PlaceMatcher([{ id: 'k', keys: ['kumasi', 'kumase'] }, { id: 'a', keys: ['accra'] }]);
    expect(m.match('Kumase, Ashanti')).toBe('k');
    expect(m.match('ACCRA')).toBe('a');
    expect(m.match('Tema')).toBeNull();
    expect(m.match(null)).toBeNull();
  });

  it('builds search text from a transcript and its translation', () => {
    const text = mediaSearchText({ title: 'Nana', description: '', originalName: 'nana.mp3', transcript: { text: 'Kuayɛ', translation: { text: 'The farm' } } } as never);
    expect(text).toContain('kuay');
    expect(text.toLowerCase()).toContain('the farm');
  });
});

// ------------------------------------------------------------------ through the API

class FakeTranscriber implements Transcriber {
  readonly enabled = true;
  maxBytes = 1024 * 1024;
  fail = false;
  calls: { filename: string; mimeType: string; translate: boolean; bytes: number }[] = [];

  async transcribe(file: Buffer, filename: string, mimeType: string, translate: boolean) {
    this.calls.push({ filename, mimeType, translate, bytes: file.length });
    if (this.fail) throw new Error('The speech service is down');
    return translate ? { text: 'Grandmother tells of the cocoa farm at Bekwai' } : { text: 'Nana ka kookoo afuo no ho asɛm', language: 'twi' };
  }
}

let ctx: TestContext;
let transcriber: FakeTranscriber;
let admin: TestClient;
let familyId: string;
let kofi: string;
let kwame: string;
let esi: string;

async function member(email: string, role = 'family_member'): Promise<TestClient> {
  const client = await registeredClient(ctx, email, email.split('@')[0]);
  await UserModel.updateOne({ email }, { emailVerifiedAt: new Date() });
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role });
  return client;
}

beforeAll(async () => {
  await connectTestDb();
  transcriber = new FakeTranscriber();
  ctx = buildApp({}, { transcriber });
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  transcriber.calls = [];
  transcriber.fail = false;
  transcriber.maxBytes = 1024 * 1024;
  admin = await registeredClient(ctx, 'admin@example.org', 'Ama Admin');
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1885 }, birthPlace: 'Kumase, Ashanti', deathPlace: 'Accra' } })).body.data;
  familyId = fam.id;
  kofi = fam.foundingMemberId;
  kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', gender: 'male', birthDate: { year: 1950 }, birthPlace: 'Accra', hometown: 'Accra' }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
  esi = await addPerson(admin, familyId, { firstName: 'Esi', surname: 'Mensah', gender: 'female', birthDate: { year: new Date().getFullYear() - 8 }, birthPlace: 'Tema' }, { parents: [{ memberId: kwame, subtype: 'biological', verification: 'verified' }] });
  await admin.post(`/families/${familyId}/events`, { kind: 'reunion', title: 'Reunion at the family house', date: { year: 1998 }, place: 'Kumasi', privacy: 'family' });
});

describe('places', () => {
  it('records places, counts who was born, died and lived there, and shows how the family moved', async () => {
    const empty = (await admin.get(`/families/${familyId}/places`)).body.data;
    expect(empty.places).toEqual([]);
    expect(empty.suggestions).toEqual(expect.arrayContaining([{ name: 'Accra', uses: 3 }, { name: 'Tema', uses: 1 }]));
    expect(empty.suggestions.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['Kumase', 'Kumasi']));

    const kumasi = await admin.post(`/families/${familyId}/places`, { name: 'Kumasi', region: 'Ashanti', country: 'Ghana', latitude: 6.69, longitude: -1.62, aliases: ['Kumase'] });
    expect(kumasi.status).toBe(201);
    expect(kumasi.body.data).toMatchObject({ name: 'Kumasi', aliases: ['Kumase'], latitude: 6.69, viewerCan: { edit: true }, version: 0 });
    const accra = (await admin.post(`/families/${familyId}/places`, { name: 'Accra' })).body.data;
    const tema = (await admin.post(`/families/${familyId}/places`, { name: 'Tema', latitude: 5.67, longitude: -0.02 })).body.data;

    const view = (await admin.get(`/families/${familyId}/places`)).body.data;
    const counts = Object.fromEntries(view.places.map((p: { name: string; counts: unknown }) => [p.name, p.counts]));
    expect(counts).toEqual({
      Accra: { births: 1, deaths: 1, hometowns: 1, events: 0 },
      Kumasi: { births: 1, deaths: 0, hometowns: 0, events: 1 },
      Tema: { births: 1, deaths: 0, hometowns: 0, events: 0 },
    });
    expect(view.suggestions).toEqual([]);
    expect(view.flows).toEqual(
      expect.arrayContaining([
        { kind: 'lifetime', from: { id: kumasi.body.data.id, name: 'Kumasi' }, to: { id: accra.id, name: 'Accra' }, people: 1 },
        { kind: 'generation', from: { id: kumasi.body.data.id, name: 'Kumasi' }, to: { id: accra.id, name: 'Accra' }, people: 1 },
        { kind: 'generation', from: { id: accra.id, name: 'Accra' }, to: { id: tema.id, name: 'Tema' }, people: 1 },
      ]),
    );
    expect(view.flows).toHaveLength(3);

    const detail = (await admin.get(`/families/${familyId}/places/${accra.id}`)).body.data;
    expect(detail.born.map((p: { id: string }) => p.id)).toEqual([kwame]);
    expect(detail.died.map((p: { id: string }) => p.id)).toEqual([kofi]);
    expect(detail.hometown.map((p: { id: string }) => p.id)).toEqual([kwame]);
    const k = (await admin.get(`/families/${familyId}/places/${kumasi.body.data.id}`)).body.data;
    expect(k.events).toMatchObject([{ title: 'Reunion at the family house', kind: 'reunion', date: { year: 1998 } }]);

    expect(await AuditLogModel.countDocuments({ action: 'place.create' })).toBe(3);
  });

  it("keeps a child's birthplace from members, as their profile does", async () => {
    const tema = (await admin.post(`/families/${familyId}/places`, { name: 'Tema' })).body.data;
    const m = await member('m@example.org');
    const view = (await m.get(`/families/${familyId}/places`)).body.data;
    expect(view.places[0]).toMatchObject({ name: 'Tema', counts: { births: 0 }, viewerCan: { edit: false } });
    expect(view.flows.find((f: { to: { name: string } }) => f.to.name === 'Tema')).toBeUndefined();
    expect((await m.get(`/families/${familyId}/places/${tema.id}`)).body.data.born).toEqual([]);
    expect((await admin.get(`/families/${familyId}/places/${tema.id}`)).body.data.born.map((p: { id: string }) => p.id)).toEqual([esi]);
  });

  it('checks names, coordinates, versions and who may change places', async () => {
    const accra = (await admin.post(`/families/${familyId}/places`, { name: 'Accra', aliases: ['Nkran'] })).body.data;
    expect((await admin.post(`/families/${familyId}/places`, { name: 'accra' })).status).toBe(409);
    expect((await admin.post(`/families/${familyId}/places`, { name: 'Nkran' })).status).toBe(409);
    expect((await admin.post(`/families/${familyId}/places`, { name: 'Ho', latitude: 6.6 })).status).toBe(400);
    expect((await admin.post(`/families/${familyId}/places`, { name: 'Ho', latitude: 96, longitude: 0 })).status).toBe(400);
    expect((await admin.post(`/families/${familyId}/places`, { name: '' })).status).toBe(400);

    const m = await member('m@example.org');
    expect((await m.post(`/families/${familyId}/places`, { name: 'Ho' })).status).toBe(403);
    expect((await m.patch(`/families/${familyId}/places/${accra.id}`, { notes: 'x', version: 0 })).status).toBe(403);
    expect((await m.delete(`/families/${familyId}/places/${accra.id}`)).status).toBe(403);
    const guest = await registeredClient(ctx, 'guest@example.org');
    expect((await guest.get(`/families/${familyId}/places`)).status).toBeGreaterThanOrEqual(403);

    const updated = await admin.patch(`/families/${familyId}/places/${accra.id}`, { latitude: 5.6, longitude: -0.19, aliases: ['Nkran', 'Ga Mashie'], version: 0 });
    expect(updated.body.data).toMatchObject({ latitude: 5.6, aliases: ['Nkran', 'Ga Mashie'], version: 1 });
    expect((await admin.patch(`/families/${familyId}/places/${accra.id}`, { notes: 'x', version: 0 })).status).toBe(409);
    expect((await admin.patch(`/families/${familyId}/places/${accra.id}`, { latitude: null, version: 1 })).status).toBe(400);

    expect((await admin.delete(`/families/${familyId}/places/${accra.id}`)).status).toBe(204);
    expect((await admin.get(`/families/${familyId}/places/${accra.id}`)).status).toBe(404);
    // The name is free again once the place is removed.
    expect((await admin.post(`/families/${familyId}/places`, { name: 'Accra' })).status).toBe(201);
    expect(await AuditLogModel.exists({ action: 'place.delete' })).toBeTruthy();
  });
});

describe('people in photos', () => {
  it('tags people with boxes, adds them to the photo and checks the boxes', async () => {
    const photo = (await admin.upload(`/families/${familyId}/media`, { buffer: await png(), name: 'wedding.png' })).body.data;
    expect(photo.tags).toEqual([]);
    const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const res = await admin.put(`/families/${familyId}/media/${photo.id}/tags`, { version: photo.version, tags: [{ memberId: kwame, box }, { memberId: esi, box: { x: 0.5, y: 0.1, w: 0.4, h: 0.5 } }] });
    expect(res.status).toBe(200);
    expect(res.body.data.tags).toEqual(expect.arrayContaining([{ person: expect.objectContaining({ id: kwame, displayName: 'Kwame Mensah' }), box }]));
    expect(res.body.data.people.map((p: { id: string }) => p.id).sort()).toEqual([esi, kwame].sort());

    // Stale version, boxes outside the photo, unknown people.
    expect((await admin.put(`/families/${familyId}/media/${photo.id}/tags`, { version: photo.version, tags: [] })).status).toBe(409);
    const v = res.body.data.version;
    expect((await admin.put(`/families/${familyId}/media/${photo.id}/tags`, { version: v, tags: [{ memberId: kwame, box: { x: 0.8, y: 0, w: 0.3, h: 0.3 } }] })).status).toBe(400);
    expect((await admin.put(`/families/${familyId}/media/${photo.id}/tags`, { version: v, tags: [{ memberId: '0123456789abcdef01234567', box }] })).status).toBeGreaterThanOrEqual(400);

    const recording = (await admin.upload(`/families/${familyId}/media`, { buffer: mp3(), name: 'nana.mp3' })).body.data;
    expect((await admin.put(`/families/${familyId}/media/${recording.id}/tags`, { version: recording.version, tags: [{ memberId: kwame, box }] })).status).toBe(400);

    // A removed person's box disappears from the photo.
    expect((await admin.delete(`/families/${familyId}/members/${esi}`)).status).toBeLessThan(300);
    const after = (await admin.get(`/families/${familyId}/media/${photo.id}`)).body.data;
    expect(after.tags.map((t: { person: { id: string } }) => t.person.id)).toEqual([kwame]);
    // Saving the photo's tags again keeps the removed person's box, ready if they are restored.
    await admin.put(`/families/${familyId}/media/${photo.id}/tags`, { version: after.version, tags: [{ memberId: kwame, box: { x: 0, y: 0, w: 0.2, h: 0.2 } }] });
    expect((await FamilyMediaModel.findById(photo.id))!.tags.map((t) => t.memberId.toString()).sort()).toEqual([esi, kwame].sort());
    expect(await AuditLogModel.exists({ action: 'media.tags' })).toBeTruthy();

    const m = await member('m@example.org');
    expect((await m.put(`/families/${familyId}/media/${photo.id}/tags`, { version: after.version + 1, tags: [] })).status).toBe(403);
  });

  it('moves tags when two people are merged, and puts them back on undo', async () => {
    const twin = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', gender: 'male', birthDate: { year: 1950 } });
    const one = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#111'), name: 'one.png' })).body.data;
    const both = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#222'), name: 'both.png' })).body.data;
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const b = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    await admin.put(`/families/${familyId}/media/${one.id}/tags`, { version: one.version, tags: [{ memberId: twin, box: a }] });
    await admin.put(`/families/${familyId}/media/${both.id}/tags`, { version: both.version, tags: [{ memberId: kwame, box: a }, { memberId: twin, box: b }] });

    const [kv, ov] = await Promise.all([admin.get(`/families/${familyId}/members/${kwame}`), admin.get(`/families/${familyId}/members/${twin}`)]);
    const merge = await admin.post(`/families/${familyId}/members/${kwame}/merge`, { otherId: twin, choices: {}, keepVersion: kv.body.data.version, otherVersion: ov.body.data.version });
    expect(merge.status).toBe(200);
    const tagsOf = async (id: string) => (await FamilyMediaModel.findById(id))!.tags.map((t) => ({ memberId: t.memberId.toString(), box: { x: t.box!.x, y: t.box!.y, w: t.box!.w, h: t.box!.h } }));
    expect(await tagsOf(one.id)).toEqual([{ memberId: kwame, box: a }]);
    expect(await tagsOf(both.id)).toEqual([{ memberId: kwame, box: a }]);

    expect((await admin.post(`/families/${familyId}/merges/${merge.body.data.id}/undo`)).status).toBe(200);
    expect(await tagsOf(one.id)).toEqual([{ memberId: twin, box: a }]);
    expect(await tagsOf(both.id)).toEqual(expect.arrayContaining([{ memberId: kwame, box: a }, { memberId: twin, box: b }]));
    expect(await tagsOf(both.id)).toHaveLength(2);
  });
});

describe('transcripts', () => {
  it('keeps typed transcripts and translations, and finds recordings by what is said', async () => {
    const rec = (await admin.upload(`/families/${familyId}/media`, { buffer: mp3(), name: 'nana.mp3' }, { title: 'Nana remembers' })).body.data;
    expect(rec.transcript).toMatchObject({ status: 'none', text: '' });
    const typed = await admin.put(`/families/${familyId}/media/${rec.id}/transcript`, { version: rec.version, text: 'Me nana tenaa Bekwai', language: 'Twi', translation: { text: 'My grandmother lived at Bekwai', language: 'English' } });
    expect(typed.status).toBe(200);
    expect(typed.body.data.transcript).toMatchObject({ status: 'done', source: 'typed', text: 'Me nana tenaa Bekwai', language: 'Twi', translation: { text: 'My grandmother lived at Bekwai', language: 'English' } });
    const found = (await admin.get(`/families/${familyId}/media?q=grandmother`)).body.data;
    expect(found.items ?? found).toEqual(expect.arrayContaining([expect.objectContaining({ id: rec.id })]));

    // Photos have no transcripts; the typed transcript stops automatic transcription until cleared.
    const photo = (await admin.upload(`/families/${familyId}/media`, { buffer: await png(), name: 'p.png' })).body.data;
    expect(photo.transcript).toBeNull();
    expect((await admin.put(`/families/${familyId}/media/${photo.id}/transcript`, { version: photo.version, text: 'x' })).status).toBe(400);
    expect((await admin.post(`/families/${familyId}/media/${rec.id}/transcribe`, {})).status).toBe(409);
    const cleared = await admin.put(`/families/${familyId}/media/${rec.id}/transcript`, { version: typed.body.data.version, text: '', translation: null });
    expect(cleared.body.data.transcript).toMatchObject({ status: 'none', source: null, translation: null });
    expect(await AuditLogModel.countDocuments({ action: 'media.transcript' })).toBe(2);

    const m = await member('m@example.org');
    expect((await m.put(`/families/${familyId}/media/${rec.id}/transcript`, { version: cleared.body.data.version, text: 'x' })).status).toBe(403);
    expect((await m.post(`/families/${familyId}/media/${rec.id}/transcribe`, {})).status).toBe(403);
  });

  it('transcribes and translates recordings with the speech service', async () => {
    const rec = (await admin.upload(`/families/${familyId}/media`, { buffer: mp3(), name: 'nana.mp3' })).body.data;
    const res = await admin.post(`/families/${familyId}/media/${rec.id}/transcribe`, { translate: true });
    expect(res.status).toBe(202);
    expect(res.body.data.transcript.status).toBe('pending');
    await ctx.instance.transcription.idle();
    expect(transcriber.calls).toEqual([
      { filename: 'nana.mp3', mimeType: 'audio/mpeg', translate: false, bytes: mp3().length },
      { filename: 'nana.mp3', mimeType: 'audio/mpeg', translate: true, bytes: mp3().length },
    ]);
    const done = (await admin.get(`/families/${familyId}/media/${rec.id}`)).body.data;
    expect(done.transcript).toMatchObject({ status: 'done', source: 'automatic', text: 'Nana ka kookoo afuo no ho asɛm', language: 'twi', translation: { text: 'Grandmother tells of the cocoa farm at Bekwai', language: 'English' } });
    const found = (await admin.get(`/families/${familyId}/media?q=cocoa`)).body.data;
    expect(found.items ?? found).toEqual(expect.arrayContaining([expect.objectContaining({ id: rec.id })]));
    expect(await AuditLogModel.exists({ action: 'media.transcribe', actorRole: 'system' })).toBeTruthy();
    expect(await AuditLogModel.exists({ action: 'media.transcribe_request' })).toBeTruthy();

    // An automatic transcript can be run again; a failure is shown to editors only.
    transcriber.fail = true;
    expect((await admin.post(`/families/${familyId}/media/${rec.id}/transcribe`, {})).status).toBe(202);
    await ctx.instance.transcription.idle();
    const failed = (await admin.get(`/families/${familyId}/media/${rec.id}`)).body.data;
    expect(failed.transcript).toMatchObject({ status: 'failed', error: 'The speech service is down' });
    const m = await member('m@example.org');
    expect((await m.get(`/families/${familyId}/media/${rec.id}`)).body.data.transcript.error).toBeNull();

    // Too large for the service.
    transcriber.maxBytes = 100;
    expect((await admin.post(`/families/${familyId}/media/${rec.id}/transcribe`, {})).status).toBe(413);
  });
});

describe('server settings for the browser', () => {
  it('says whether maps and transcription are available', async () => {
    const plain = buildApp();
    const maps = buildApp({ MAP_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' });
    try {
      expect((await new TestClient(plain).get('/config')).body.data).toEqual({ mapTiles: null, transcription: false, google: false });
      expect((await new TestClient(maps).get('/config')).body.data).toEqual({ mapTiles: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 18 }, transcription: false, google: false });
      expect((await new TestClient(ctx).get('/config')).body.data.transcription).toBe(true);
      // Without a speech service, transcription is refused politely.
      const client = await registeredClient(plain, 'solo@example.org');
      const fam = (await client.post('/families', { name: 'Solo', founder: { firstName: 'Yaw', surname: 'Solo' } })).body.data;
      const rec = (await client.upload(`/families/${fam.id}/media`, { buffer: mp3(), name: 'a.mp3' })).body.data;
      const res = await client.post(`/families/${fam.id}/media/${rec.id}/transcribe`, {});
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/not set up/);
    } finally {
      await plain.instance.close();
      await maps.instance.close();
    }
  });
});
