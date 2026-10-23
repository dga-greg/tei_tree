import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let kofi: string;
let kwame: string;
let yaw: string;

async function jpegWithLocation(color = '#a33'): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestCam', Copyright: 'private' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '5/1 36/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 11/1 0/1' } })
    .toBuffer();
}
const png = (color = '#3a3') => sharp({ create: { width: 30, height: 20, channels: 4, background: color } }).png().toBuffer();
const pdf = () => Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');
const mp3 = () => Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x0a' + '\0'.repeat(10) + '\xff\xfb\x90\x00' + '\0'.repeat(4000), 'latin1');

/** Follows the permission-checked redirect to the signed file link, without cookies (as an <img> on S3 would). */
async function fetchFile(client: TestClient, path: string, headers: Record<string, string> = {}) {
  const redirect = await client.get(path);
  expect(redirect.status).toBe(302);
  const location = redirect.headers['location'] as string;
  let req = request(ctx.instance.app).get(location).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return { location, res: await req };
}

async function member(email: string, role = 'family_member'): Promise<TestClient> {
  const client = await registeredClient(ctx, email, email.split('@')[0]);
  await UserModel.updateOne({ email }, { emailVerifiedAt: new Date() });
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role });
  return client;
}

beforeAll(async () => {
  await connectTestDb();
  ctx = buildApp();
});
afterAll(async () => {
  vi.useRealTimers();
  await ctx.instance.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  admin = await registeredClient(ctx, 'admin@example.org', 'Ama Admin');
  const fam = (
    await admin.post('/families', {
      name: 'Mensah Family',
      privacy: { visibility: 'public' },
      founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased', birthDate: { year: 1885 }, deathDate: { year: 1962, month: 4 }, privacy: { level: 'public' } },
    })
  ).body.data;
  familyId = fam.id;
  kofi = fam.foundingMemberId;
  kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', vitalStatus: 'living', birthDate: { year: 1950, month: 3, day: 12 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
  yaw = await addPerson(admin, familyId, { firstName: 'Yaw', surname: 'Mensah', vitalStatus: 'living', birthDate: { year: new Date().getFullYear() - 8, month: 6, day: 1 } }, { parents: [{ memberId: kwame, subtype: 'biological', verification: 'verified' }] });
});

describe('uploading files', () => {
  it('re-encodes photos without camera or location data and serves them only through signed links', async () => {
    const original = await jpegWithLocation();
    expect((await sharp(original).metadata()).exif?.toString('latin1')).toContain('TestCam');

    const up = await admin.upload(`/families/${familyId}/media`, { buffer: original, name: 'kofi_wedding.jpg', type: 'image/jpeg' }, { memberIds: [kofi], date: { year: 1920, qualifier: 'about' }, provenance: { source: "Auntie Ama's album" } });
    expect(up.status).toBe(201);
    const m = up.body.data;
    expect(m).toMatchObject({ kind: 'photo', mimeType: 'image/jpeg', title: 'kofi wedding', width: 64, height: 48, status: 'published', privacy: 'family' });
    expect(m.people.map((p: { id: string }) => p.id)).toEqual([kofi]);
    expect(m.provenance.source).toBe("Auntie Ama's album");

    const { location, res } = await fetchFile(admin, `/families/${familyId}/media/${m.id}/content`);
    expect(location).toMatch(/^\/api\/v1\/files\//);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    const stored = await sharp(res.body as Buffer).metadata();
    expect(stored.width).toBe(64);
    expect(stored.exif).toBeUndefined();
    expect((res.body as Buffer).toString('latin1')).not.toContain('TestCam');

    const thumb = await fetchFile(admin, `/families/${familyId}/media/${m.id}/content?variant=thumb`);
    expect(thumb.res.headers['content-type']).toBe('image/webp');

    const download = await fetchFile(admin, `/families/${familyId}/media/${m.id}/content?download=1`);
    expect(download.res.headers['content-disposition']).toMatch(/^attachment; filename="kofi wedding\.jpg"/);

    const range = await fetchFile(admin, `/families/${familyId}/media/${m.id}/content`, { Range: 'bytes=0-9' });
    expect(range.res.status).toBe(206);
    expect((range.res.body as Buffer).length).toBe(10);
  });

  it('refuses altered and expired links', async () => {
    const m = (await admin.upload(`/families/${familyId}/media`, { buffer: await png(), name: 'a.png' })).body.data;
    const { location } = await fetchFile(admin, `/families/${familyId}/media/${m.id}/content`);
    const [payload, sig] = location.slice('/api/v1/files/'.length).split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), k: 'families/x/media/y/original.png' })).toString('base64url');
    expect((await request(ctx.instance.app).get(`/api/v1/files/${forged}.${sig}`)).status).toBe(404);
    expect((await request(ctx.instance.app).get(`/api/v1/files/${payload}.${sig!.slice(0, -2)}xx`)).status).toBe(404);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    expect((await request(ctx.instance.app).get(location)).status).toBe(404);
    vi.useRealTimers();
  });

  it('decides what a file is from its content, never from its name or claimed type', async () => {
    const html = await admin.upload(`/families/${familyId}/media`, { buffer: Buffer.from('<!doctype html><script>alert(1)</script>'), name: 'photo.jpg', type: 'image/jpeg' });
    expect(html.status).toBe(415);
    expect(html.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const svg = await admin.upload(`/families/${familyId}/media`, { buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), name: 'logo.svg', type: 'image/svg+xml' });
    expect(svg.status).toBe(415);
    const exe = await admin.upload(`/families/${familyId}/media`, { buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]), name: 'birth-certificate.pdf', type: 'application/pdf' });
    expect(exe.status).toBe(415);

    const doc = await admin.upload(`/families/${familyId}/media`, { buffer: pdf(), name: 'certificate.png', type: 'image/png' }, { title: 'Birth certificate' });
    expect(doc.status).toBe(201);
    expect(doc.body.data).toMatchObject({ kind: 'document', mimeType: 'application/pdf', urls: { thumb: null } });
    const audio = await admin.upload(`/families/${familyId}/media`, { buffer: mp3(), name: 'interview' });
    expect(audio.body.data).toMatchObject({ kind: 'audio', mimeType: 'audio/mpeg' });

    const broken = await admin.upload(`/families/${familyId}/media`, { buffer: Buffer.concat([(await jpegWithLocation()).subarray(0, 40)]), name: 'cut.jpg' });
    expect(broken.status).toBe(415);
  });

  it('refuses duplicates, empty uploads and requests that are not uploads', async () => {
    const buffer = await png('#123');
    expect((await admin.upload(`/families/${familyId}/media`, { buffer, name: 'one.png' })).status).toBe(201);
    const again = await admin.upload(`/families/${familyId}/media`, { buffer, name: 'copy.png' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('already in the family archive');
    expect((await admin.upload(`/families/${familyId}/media`, { buffer: Buffer.alloc(0), name: 'empty.png' })).status).toBe(400);
    expect((await admin.post(`/families/${familyId}/media`, { title: 'x' })).status).toBe(400);
    const badField = await admin.upload(`/families/${familyId}/media`, { buffer: await png('#456'), name: 'b.png' }, { memberIds: ['not-an-id'] });
    expect(badField.status).toBe(400);
  });

  it('enforces the size limit while receiving the file', async () => {
    const small = buildApp({ MEDIA_MAX_UPLOAD_MB: '1' });
    const client = await registeredClient(small, 'big@example.org');
    const fam = (await client.post('/families', { name: 'Big Family' })).body.data;
    const res = await client.upload(`/families/${fam.id}/media`, { buffer: Buffer.concat([pdf(), Buffer.alloc(1024 * 1024 + 10)]), name: 'big.pdf' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    await small.instance.close();
  });
});

describe('who sees what', () => {
  it('applies privacy for members, administrators and guests of public families', async () => {
    const family = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#111'), name: 'family.png' }, { memberIds: [kofi] })).body.data;
    const admins = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#222'), name: 'admins.png' }, { privacy: 'admins' })).body.data;
    const publicFounder = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#333'), name: 'founder.png' }, { privacy: 'public', memberIds: [kofi] })).body.data;
    const publicLiving = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#444'), name: 'kwame.png' }, { privacy: 'public', memberIds: [kwame] })).body.data;

    const m = await member('m@example.org');
    const seen = (await m.get(`/families/${familyId}/media`)).body.data.map((x: { id: string }) => x.id);
    expect(seen).toEqual(expect.arrayContaining([family.id, publicFounder.id, publicLiving.id]));
    expect(seen).not.toContain(admins.id);
    expect((await m.get(`/families/${familyId}/media/${admins.id}/content`)).status).toBe(404);
    expect((await admin.get(`/families/${familyId}/media`)).body.meta.total).toBe(4);

    // Guests: public items only, and never items about people hidden from guests (living Kwame).
    const guest = await new TestClient(ctx).init();
    const guestSeen = (await guest.get(`/families/${familyId}/media`)).body.data.map((x: { id: string }) => x.id);
    expect(guestSeen).toEqual([publicFounder.id]);
    expect((await guest.get(`/families/${familyId}/media/${publicLiving.id}/content`)).status).toBe(404);
    expect((await guest.get(`/families/${familyId}/media/${publicFounder.id}`)).body.data.uploadedBy).toBeNull();
    expect((await guest.upload(`/families/${familyId}/media`, { buffer: await png('#555'), name: 'x.png' })).status).toBe(401);

    // Outsiders of a private family learn nothing.
    const other = await registeredClient(ctx, 'other@example.org');
    const priv = (await other.post('/families', { name: 'Private Family' })).body.data;
    expect((await admin.get(`/families/${priv.id}/media`)).status).toBe(404);
  });

  it('lets uploaders and administrators edit and remove files; removal stops new links at once', async () => {
    const m = await member('m@example.org');
    const mine = (await m.upload(`/families/${familyId}/media`, { buffer: await png('#abc'), name: 'mine.png' })).body.data;
    const theirs = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#def'), name: 'theirs.png' })).body.data;
    expect(theirs.viewerCan).toMatchObject({ edit: true, delete: true });
    const asMember = (await m.get(`/families/${familyId}/media/${theirs.id}`)).body.data;
    expect(asMember.viewerCan.edit).toBe(false);
    expect((await m.patch(`/families/${familyId}/media/${theirs.id}`, { version: asMember.version, title: 'Mine now' })).status).toBe(403);
    expect((await m.patch(`/families/${familyId}/media/${mine.id}`, { version: mine.version, title: 'Renamed', description: 'At the reunion' })).body.data.title).toBe('Renamed');
    expect((await m.patch(`/families/${familyId}/media/${mine.id}`, { version: mine.version, title: 'Stale' })).status).toBe(409);

    const search = (await admin.get(`/families/${familyId}/media?q=reunion`)).body.data;
    expect(search.map((x: { id: string }) => x.id)).toEqual([mine.id]);

    expect((await admin.delete(`/families/${familyId}/media/${theirs.id}`)).status).toBe(204);
    expect((await admin.get(`/families/${familyId}/media/${theirs.id}/content`)).status).toBe(404);
    expect((await admin.get(`/families/${familyId}/audit?targetId=${theirs.id}`)).body.data.map((e: { action: string }) => e.action)).toEqual(['media.delete', 'media.upload']);
  });
});

describe('review of additions by members', () => {
  it('holds member uploads until a moderator approves them', async () => {
    await admin.patch(`/families/${familyId}`, { version: (await admin.get(`/families/${familyId}`)).body.data.version, privacy: { allowMemberUploads: true } });
    const m = await member('m@example.org');
    // m is a moderator? no: plain members' uploads wait for review.
    const upload = await m.upload(`/families/${familyId}/media`, { buffer: await png('#777'), name: 'reunion.png' }, { memberIds: [kwame], note: 'From the 1998 reunion' });
    expect(upload.body.data.status).toBe('pending_approval');
    const other = await member('o@example.org');
    expect((await other.get(`/families/${familyId}/media`)).body.data).toHaveLength(0);
    expect((await m.get(`/families/${familyId}/media`)).body.data).toHaveLength(1);

    const queue = (await admin.get(`/families/${familyId}/contributions`)).body.data;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ kind: 'media.attach', summary: 'Add “reunion” to the archive', archiveItem: { type: 'media', title: 'reunion' } });
    expect(queue[0].discussion[0].message).toBe('From the 1998 reunion');
    expect((await admin.get(`/families/${familyId}/media?status=pending_approval`)).body.data).toHaveLength(1);

    expect((await admin.post(`/families/${familyId}/contributions/${queue[0].id}/approve`, { force: false })).status).toBe(200);
    expect((await admin.get(`/families/${familyId}/contributions?status=approved`)).body.data).toHaveLength(1);
    expect((await other.get(`/families/${familyId}/media`)).body.data[0].status).toBe('published');

    // Rejection keeps it hidden from everyone but the uploader; withdrawal removes it.
    const second = (await m.upload(`/families/${familyId}/media`, { buffer: await png('#888'), name: 'blurry.png' })).body.data;
    const c2 = (await admin.get(`/families/${familyId}/contributions`)).body.data[0];
    expect((await admin.post(`/families/${familyId}/contributions/${c2.id}/reject`, { note: 'Too blurry to keep' })).status).toBe(200);
    expect((await other.get(`/families/${familyId}/media/${second.id}`)).status).toBe(404);
    expect((await m.get(`/families/${familyId}/media/${second.id}`)).body.data.status).toBe('rejected');

    const third = (await m.upload(`/families/${familyId}/media`, { buffer: await png('#999'), name: 'oops.png' })).body.data;
    const c3 = (await m.get(`/families/${familyId}/contributions?mine=true`)).body.data.find((c: { archiveItem: { id: string } | null }) => c.archiveItem?.id === third.id);
    expect((await m.post(`/families/${familyId}/contributions/${c3.id}/withdraw`, {})).status).toBe(200);
    expect((await m.get(`/families/${familyId}/media/${third.id}`)).status).toBe(404);

    expect((await m.post(`/families/${familyId}/contributions`, { kind: 'media.attach', targetId: third.id, payload: {} })).status).toBe(400);
  });

  it('refuses member uploads when the family does not accept them', async () => {
    await admin.patch(`/families/${familyId}`, { version: (await admin.get(`/families/${familyId}`)).body.data.version, privacy: { allowMemberUploads: false } });
    const m = await member('m@example.org');
    const res = await m.upload(`/families/${familyId}/media`, { buffer: await png(), name: 'x.png' });
    expect(res.status).toBe(403);
    const mod = await member('mod@example.org', 'family_moderator');
    expect((await mod.upload(`/families/${familyId}/media`, { buffer: await png(), name: 'x.png' })).body.data.status).toBe('published');
  });
});

describe('profile photos', () => {
  it('uses a published photo as a profile picture, and drops it when the photo goes', async () => {
    const photo = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#0a0'), name: 'kwame.png' }, { memberIds: [kwame] })).body.data;
    const doc = (await admin.upload(`/families/${familyId}/media`, { buffer: pdf(), name: 'doc.pdf' })).body.data;
    const before = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data;
    expect((await admin.patch(`/families/${familyId}/members/${kwame}`, { version: before.version, profilePhotoMediaId: doc.id })).status).toBe(400);
    const set = await admin.patch(`/families/${familyId}/members/${kwame}`, { version: before.version, profilePhotoMediaId: photo.id });
    expect(set.status).toBe(200);
    const after = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data;
    expect(after.profilePhotoMediaId).toBe(photo.id);
    expect(after.photoUrl).toBe(`/api/v1/families/${familyId}/media/${photo.id}/content?variant=thumb&ngsw-bypass=1`);
    expect((await admin.get(`/families/${familyId}/members?q=kwame`)).body.data[0].photoUrl).toBe(after.photoUrl);

    await admin.delete(`/families/${familyId}/media/${photo.id}`);
    expect((await admin.get(`/families/${familyId}/members/${kwame}`)).body.data.photoUrl).toBeNull();
  });

  it('sets a profile photo in the same upload, tagging the person', async () => {
    const res = await admin.upload(`/families/${familyId}/media`, { buffer: await png('#0b0'), name: 'yaw.jpg' }, { profileOf: yaw, title: 'Profile photo of Yaw' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'published', title: 'Profile photo of Yaw' });
    expect(res.body.data.people.map((p: { id: string }) => p.id)).toEqual([yaw]);
    expect((await admin.get(`/families/${familyId}/members/${yaw}`)).body.data.profilePhotoMediaId).toBe(res.body.data.id);
    const history = (await admin.get(`/families/${familyId}/audit?targetId=${yaw}`)).body.data;
    expect(history.some((h: { action: string }) => h.action === 'member.update')).toBe(true);

    // Only pictures, visible to the family, of people in it.
    const doc = await admin.upload(`/families/${familyId}/media`, { buffer: pdf(), name: 'doc.pdf' }, { profileOf: yaw });
    expect(doc.status).toBe(400);
    expect((await admin.upload(`/families/${familyId}/media`, { buffer: await png('#0c0'), name: 'a.png' }, { profileOf: yaw, privacy: 'admins' })).status).toBe(400);
    expect((await admin.upload(`/families/${familyId}/media`, { buffer: await png('#0d0'), name: 'b.png' }, { profileOf: '0123456789abcdef01234567' })).status).toBe(404);
    expect((await admin.get(`/families/${familyId}/media`)).body.data).toHaveLength(1);

    // The same picture again, for someone else, reuses the copy in the archive.
    const again = await admin.upload(`/families/${familyId}/media`, { buffer: await png('#0b0'), name: 'same.png' }, { profileOf: kwame });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(res.body.data.id);
    expect(again.body.data.people.map((p: { id: string }) => p.id).sort()).toEqual([kwame, yaw].sort());
    expect((await admin.get(`/families/${familyId}/members/${kwame}`)).body.data.profilePhotoMediaId).toBe(res.body.data.id);
    expect((await admin.upload(`/families/${familyId}/media`, { buffer: await png('#0b0'), name: 'same.png' })).status).toBe(409);
  });

  it("holds a member's profile photo for review and sets it once approved", async () => {
    await admin.patch(`/families/${familyId}`, { version: (await admin.get(`/families/${familyId}`)).body.data.version, privacy: { allowMemberUploads: true } });
    const m = await member('m@example.org');
    const up = await m.upload(`/families/${familyId}/media`, { buffer: await png('#0e0'), name: 'kwame.png' }, { profileOf: kwame, title: 'Kwame at home' });
    expect(up.status).toBe(201);
    expect(up.body.data.status).toBe('pending_approval');
    expect((await admin.get(`/families/${familyId}/members/${kwame}`)).body.data.profilePhotoMediaId).toBeNull();

    const queue = (await admin.get(`/families/${familyId}/contributions`)).body.data;
    expect(queue[0]).toMatchObject({ kind: 'media.attach', summary: 'Add “Kwame at home” as the profile photo of Kwame Mensah' });
    expect((await admin.post(`/families/${familyId}/contributions/${queue[0].id}/approve`, { force: false })).status).toBe(200);
    expect((await admin.get(`/families/${familyId}/members/${kwame}`)).body.data.profilePhotoMediaId).toBe(up.body.data.id);

    // A moderator whose uploads are published at once sets it straight away.
    const mod = await member('mod@example.org', 'family_moderator');
    const direct = await mod.upload(`/families/${familyId}/media`, { buffer: await png('#0f0'), name: 'c.png' }, { profileOf: kwame });
    expect(direct.body.data.status).toBe('published');
    expect((await admin.get(`/families/${familyId}/members/${kwame}`)).body.data.profilePhotoMediaId).toBe(direct.body.data.id);
  });
});

describe('stories and oral histories', () => {
  it('publishes stories by administrators and reviews stories by members', async () => {
    const recording = (await admin.upload(`/families/${familyId}/media`, { buffer: mp3(), name: 'grandma.mp3' })).body.data;
    const photo = (await admin.upload(`/families/${familyId}/media`, { buffer: await png('#a0a'), name: 'farm.png' })).body.data;
    expect((await admin.post(`/families/${familyId}/stories`, { kind: 'oral_history', title: 'Bad', recordingMediaId: photo.id })).status).toBe(400);
    expect((await admin.post(`/families/${familyId}/stories`, { kind: 'story', title: 'Empty' })).status).toBe(400);

    const oral = await admin.post(`/families/${familyId}/stories`, {
      kind: 'oral_history',
      title: 'How Kofi came to Kumasi',
      narrator: 'Auntie Ama',
      body: 'Kofi walked from the coast in 1905.\n\nHe planted the first cocoa.',
      date: { year: 1905, qualifier: 'about' },
      memberIds: [kofi],
      mediaIds: [photo.id],
      recordingMediaId: recording.id,
    });
    expect(oral.status).toBe(201);
    expect(oral.body.data).toMatchObject({ status: 'published', narrator: 'Auntie Ama', recording: { id: recording.id, kind: 'audio' }, media: [{ id: photo.id }], people: [{ id: kofi }] });

    const m = await member('m@example.org');
    const story = await m.post(`/families/${familyId}/stories`, { kind: 'memory', title: 'Sunday lunches', body: 'Every Sunday we gathered at Kwame’s house.', memberIds: [kwame], note: 'My own memory' });
    expect(story.body.data.status).toBe('pending_approval');
    const other = await member('o@example.org');
    expect((await other.get(`/families/${familyId}/stories`)).body.data.map((s: { id: string }) => s.id)).toEqual([oral.body.data.id]);
    const c = (await admin.get(`/families/${familyId}/contributions`)).body.data[0];
    expect(c).toMatchObject({ kind: 'story.create', summary: 'Add the story “Sunday lunches”', archiveItem: { type: 'story', excerpt: 'Every Sunday we gathered at Kwame’s house.' } });
    expect((await admin.post(`/families/${familyId}/contributions/${c.id}/approve`, {})).status).toBe(200);
    expect((await other.get(`/families/${familyId}/stories?memberId=${kwame}`)).body.data[0].title).toBe('Sunday lunches');

    // Authors edit their own stories; other members cannot.
    const own = (await m.get(`/families/${familyId}/stories/${story.body.data.id}`)).body.data;
    expect(own.viewerCan.edit).toBe(true);
    expect((await m.patch(`/families/${familyId}/stories/${own.id}`, { version: own.version, title: 'Sunday lunches at Kwame’s' })).status).toBe(200);
    const asOther = (await other.get(`/families/${familyId}/stories/${own.id}`)).body.data;
    expect(asOther.viewerCan.edit).toBe(false);
    expect((await other.patch(`/families/${familyId}/stories/${own.id}`, { version: asOther.version + 1, title: 'x' })).status).toBe(403);
    expect((await admin.get(`/families/${familyId}/stories?q=cocoa`)).body.data.map((s: { title: string }) => s.title)).toEqual(['How Kofi came to Kumasi']);

    // Guests see public stories only.
    await admin.patch(`/families/${familyId}/stories/${oral.body.data.id}`, { version: oral.body.data.version, privacy: 'public' });
    const guest = await new TestClient(ctx).init();
    const forGuest = (await guest.get(`/families/${familyId}/stories`)).body.data;
    expect(forGuest.map((s: { title: string }) => s.title)).toEqual(['How Kofi came to Kumasi']);
    expect(forGuest[0].recording).toBeNull(); // the recording itself is family-only
  });
});

describe('events and the family timeline', () => {
  it('combines recorded events, stories and life events under the profile privacy rules', async () => {
    const restricted = await addPerson(admin, familyId, { firstName: 'Esi', surname: 'Mensah', vitalStatus: 'deceased', birthDate: { year: 1920 }, privacy: { level: 'restricted' } });
    const akosua = await addPerson(admin, familyId, { firstName: 'Akosua', surname: 'Owusu', vitalStatus: 'deceased', birthDate: { year: 1890 }, privacy: { level: 'public' } });
    await admin.post(`/families/${familyId}/relationships`, { type: 'partnership', personA: kofi, personB: akosua, subtype: 'customary_marriage', verification: 'verified', startDate: { year: 1910 } });

    const m = await member('m@example.org');
    expect((await m.post(`/families/${familyId}/events`, { kind: 'reunion', title: 'Reunion' })).status).toBe(403);
    const ev = await admin.post(`/families/${familyId}/events`, { kind: 'migration', title: 'The move to Kumasi', date: { year: 1905 }, place: 'Kumasi', memberIds: [kofi], privacy: 'public' });
    expect(ev.status).toBe(201);
    await admin.upload(`/families/${familyId}/media`, { buffer: await png('#0aa'), name: 'road.png' }, { eventId: ev.body.data.id, privacy: 'public' });
    await admin.post(`/families/${familyId}/stories`, { kind: 'story', title: 'The first harvest', body: 'Cocoa.', date: { year: 1912 } });

    const timeline = (await m.get(`/families/${familyId}/timeline`)).body.data as { key: string; title: string; date: { year: number; month?: number; day?: number }; thumbUrl: string | null }[];
    const titles = timeline.map((t) => t.title);
    expect(titles).toEqual([
      'Kofi Mensah was born',
      'Akosua Owusu was born',
      'The move to Kumasi',
      'Kofi Mensah and Akosua Owusu married',
      'The first harvest',
      'Kwame Mensah was born',
      'Kofi Mensah died',
      'Yaw Mensah was born',
    ]);
    expect(titles.join()).not.toContain('Esi');
    expect(timeline.find((t) => t.title === 'The move to Kumasi')!.thumbUrl).toMatch(/variant=thumb&ngsw-bypass=1$/);
    // A child's exact birthday is shown as a year only to other members.
    const yawBirth = timeline.find((t) => t.title === 'Yaw Mensah was born')!;
    expect(yawBirth.date.month).toBeUndefined();
    expect((await admin.get(`/families/${familyId}/timeline`)).body.data.find((t: { title: string }) => t.title === 'Yaw Mensah was born').date.month).toBe(6);

    // Filters.
    const kofiOnly = (await m.get(`/families/${familyId}/timeline?memberId=${kofi}`)).body.data.map((t: { title: string }) => t.title);
    expect(kofiOnly).toEqual(['Kofi Mensah was born', 'The move to Kumasi', 'Kofi Mensah and Akosua Owusu married', 'Kofi Mensah died']);
    const decade = (await m.get(`/families/${familyId}/timeline?from=1900&to=1909`)).body.data.map((t: { title: string }) => t.title);
    expect(decade).toEqual(['The move to Kumasi']);

    // Guests: only public, deceased people and public events.
    const guest = await new TestClient(ctx).init();
    const forGuest = (await guest.get(`/families/${familyId}/timeline`)).body.data.map((t: { title: string }) => t.title);
    expect(forGuest).toEqual(['Kofi Mensah was born', 'Akosua Owusu was born', 'The move to Kumasi', 'Kofi Mensah and Akosua Owusu married', 'Kofi Mensah died']);
    expect(restricted).toBeTruthy();

    // Event detail includes files uploaded for it.
    const detail = (await m.get(`/families/${familyId}/events/${ev.body.data.id}`)).body.data;
    expect(detail.media).toHaveLength(1);
    expect(detail.viewerCan.edit).toBe(false);
    const upd = await admin.patch(`/families/${familyId}/events/${ev.body.data.id}`, { version: ev.body.data.version, title: 'Kofi moves to Kumasi' });
    expect(upd.body.data.title).toBe('Kofi moves to Kumasi');
    expect((await admin.delete(`/families/${familyId}/events/${ev.body.data.id}`)).status).toBe(204);
    expect((await m.get(`/families/${familyId}/events`)).body.data).toHaveLength(0);
  });
});
