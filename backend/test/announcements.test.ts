import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger.js';
import { CloudWhatsAppSender, GiantSmsSender, LogSmsSender, normalisePhone, smsParts } from '../src/infra/messaging.js';
import { sendingTime } from '../src/modules/announcements/announcements.service.js';
import { AnnouncementModel } from '../src/modules/announcements/announcement.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { FamilyMemberModel } from '../src/modules/members/member.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

describe('messaging providers', () => {
  it('writes phone numbers the way providers want them', () => {
    expect(normalisePhone('024 412 3456')).toBe('233244123456');
    expect(normalisePhone('+233 24 412 3456')).toBe('233244123456');
    expect(normalisePhone('00233244123456')).toBe('233244123456');
    expect(normalisePhone('244123456')).toBe('233244123456');
    expect(normalisePhone('+44 7700 900123')).toBe('447700900123');
    expect(normalisePhone('call me')).toBeNull();
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });

  it('counts SMS parts, shorter when the text needs Unicode', () => {
    expect(smsParts('a'.repeat(160)).parts).toBe(1);
    expect(smsParts('a'.repeat(161)).parts).toBe(2);
    expect(smsParts('Akwaaba ɛ'.padEnd(71, 'a'))).toEqual({ parts: 2, partLength: 70 });
  });

  it('sends through GiantSMS with the API token, and reports its errors', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(calls.length === 1 ? { status: true, message: 'Message sent', data: { message_id: 'm-1' } } : { status: false, message: 'Insufficient balance' }), { status: 200 });
    }) as unknown as typeof fetch;
    const giant = new GiantSmsSender('dG9rZW4=', 'MyFamily', fake);
    expect(await giant.send('233244123456', 'Hello')).toEqual({ ok: true, id: 'm-1' });
    expect(calls[0]!.url).toBe('https://api.giantsms.com/api/v1/send');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Basic dG9rZW4=');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ from: 'MyFamily', to: '233244123456', msg: 'Hello' });
    expect(await giant.send('233244123456', 'Hello')).toEqual({ ok: false, error: 'Insufficient balance' });
  });

  it('sends WhatsApp messages as an approved template', async () => {
    let body: Record<string, unknown> = {};
    const fake = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://graph.facebook.com/v21.0/12345/messages');
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const wa = new CloudWhatsAppSender('token', '12345', 'family_announcement', 'en', fake);
    expect(await wa.send('233244123456', { firstName: 'Kwame', text: 'Funeral of Nana\n\nSaturday', link: 'https://x/r/abc' })).toEqual({ ok: true, id: 'wamid.1' });
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '233244123456', type: 'template', template: { name: 'family_announcement', language: { code: 'en' } } });
    const params = (body['template'] as { components: { parameters: { text: string }[] }[] }).components[0]!.parameters.map((p) => p.text);
    expect(params).toEqual(['Kwame', 'Funeral of Nana · Saturday', 'https://x/r/abc']);
  });

  it('holds messages written at night in Ghana until 7:00', () => {
    const tz = 'Africa/Accra';
    expect(sendingTime(new Date('2026-10-18T10:00:00Z'), tz).toISOString()).toBe('2026-10-18T10:00:00.000Z');
    expect(sendingTime(new Date('2026-10-18T22:30:00Z'), tz).toISOString()).toBe('2026-10-19T07:00:00.000Z');
    expect(sendingTime(new Date('2026-10-18T03:00:00Z'), tz).toISOString()).toBe('2026-10-18T07:00:00.000Z');
    // Elsewhere the same rule follows the local clock: 22:00 in Lagos is 21:00 UTC.
    expect(sendingTime(new Date('2026-10-18T21:00:00Z'), 'Africa/Lagos').toISOString()).toBe('2026-10-19T06:00:00.000Z');
  });
});

let ctx: TestContext;
let sms: LogSmsSender;
let whatsapp: LogSmsSender;
let admin: TestClient;
let familyId: string;
let kofi: string;
let kwame: string;
let ama: string;
let yaw: string;
let eventId: string;

const inTenDays = () => {
  const d = new Date(Date.now() + 10 * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), qualifier: 'exact' };
};
const tokenIn = (text: string) => /\/r\/([A-Za-z0-9_-]{22})/.exec(text)![1]!;

async function member(email: string, role = 'family_member', profile?: string): Promise<TestClient> {
  const client = await registeredClient(ctx, email, email.split('@')[0]);
  await UserModel.updateOne({ email }, { emailVerifiedAt: new Date() });
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role, ...(profile ? { memberProfileId: profile } : {}) });
  return client;
}

beforeAll(async () => {
  await connectTestDb();
  const logger = createLogger('silent', false);
  sms = new LogSmsSender('log', logger, 'sms');
  whatsapp = new LogSmsSender('log', logger, 'whatsapp');
  ctx = buildApp({ MESSAGING_QUIET_HOURS: 'false', SMS_MONTHLY_LIMIT_PER_FAMILY: '6' }, { messaging: { sms, whatsapp } });
});
afterAll(async () => {
  await ctx.instance.close();
  await disconnectTestDb();
});
beforeEach(async () => {
  await clearDb();
  sms.outbox.length = 0;
  whatsapp.outbox.length = 0;
  ctx.mailer.outbox.length = 0;
  admin = await registeredClient(ctx, 'admin@example.org', 'Ama Admin');
  const fam = (await admin.post('/families', { name: 'Apeatu Family', founder: { firstName: 'Kofi', surname: 'Apeatu', vitalStatus: 'deceased' } })).body.data;
  familyId = fam.id;
  kofi = fam.foundingMemberId;
  await FamilyMemberModel.updateOne({ _id: kofi }, { $set: { contact: { phone: '0201112223' } } });
  const child = { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] };
  kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Apeatu', vitalStatus: 'living', contact: { phone: '024 412 3456' } }, child);
  ama = await addPerson(admin, familyId, { firstName: 'Ama', surname: 'Apeatu', vitalStatus: 'living' }, child);
  yaw = await addPerson(admin, familyId, { firstName: 'Yaw', surname: 'Apeatu', vitalStatus: 'living' }, child);
  eventId = (await admin.post(`/families/${familyId}/events`, { kind: 'funeral', title: 'Funeral of Nana Kofi', date: inTenDays(), place: 'Larteh' })).body.data.id;
});

const announce = (client: TestClient, body: Record<string, unknown> = {}) =>
  client.post(`/families/${familyId}/events/${eventId}/announcements`, { audience: { kind: 'all' }, channels: ['sms', 'whatsapp', 'email'], message: 'The funeral of Nana Kofi is on Saturday at Larteh.', rsvp: true, remind: true, ...body });

describe('ceremony announcements', () => {
  it('reaches each living relative on the channels they have, and lists who cannot be reached', async () => {
    await member('ama@example.org', 'family_member', ama);
    expect((await admin.get(`/families/${familyId}/messaging`)).body.data).toMatchObject({ sms: true, whatsapp: true, smsLeftThisMonth: 6, smsPricePesewas: 3 });

    const preview = (await admin.post(`/families/${familyId}/events/${eventId}/announcements/preview`, { audience: { kind: 'all' }, channels: ['sms', 'whatsapp', 'email', 'push'], message: 'The funeral is on Saturday.', rsvp: true, remind: false })).body.data;
    // Kofi has died; Kwame has a phone; Ama has an account; Yaw has neither.
    expect(preview).toMatchObject({ recipients: 2, bySms: 1, byWhatsapp: 1, byEmail: 1, byPush: 1, optedOut: 0, smsParts: 1, smsCostPesewas: 3, heldUntil: null });
    expect(preview.unreachable.map((p: { id: string }) => p.id)).toEqual([yaw]);

    const res = await announce(admin);
    expect(res.status).toBe(201);
    await ctx.instance.announcements.idle();
    expect(sms.outbox).toHaveLength(1);
    expect(sms.outbox[0]!.to).toBe('233244123456');
    expect(sms.outbox[0]!.text).toMatch(/^Apeatu Family announcement:\nThe funeral of Nana Kofi is on Saturday at Larteh\.\nAre you coming\? Answer here: http:\/\/localhost:4200\/r\/[A-Za-z0-9_-]{22}$/);
    expect(whatsapp.outbox).toHaveLength(1);
    expect(ctx.mailer.outbox.find((m) => m.to === 'ama@example.org' && m.subject === 'Apeatu Family: Funeral of Nana Kofi')).toBeTruthy();

    const list = (await admin.get(`/families/${familyId}/events/${eventId}/announcements`)).body.data;
    expect(list[0]).toMatchObject({ status: 'sent', audience: 'Everyone', sentBy: 'Ama Admin', counts: { recipients: 2, sms: 1, whatsapp: 1, email: 1, failed: 0 }, rsvp: { enabled: true, yes: 0, no: 0, waiting: 2 }, remind: { enabled: true, sentAt: null } });
    const recipients = (await admin.get(`/families/${familyId}/announcements/${list[0].id}/recipients`)).body.data;
    expect(recipients.find((r: { person: { id: string } }) => r.person.id === kwame)).toMatchObject({ phone: '…456', delivery: { sms: 'sent', whatsapp: 'sent', email: 'skipped' }, rsvp: null });
    expect((await admin.get(`/families/${familyId}/events/${eventId}`)).body.data.viewerCan.announce).toBe(true);
    // One SMS part used of the month's six.
    expect((await admin.get(`/families/${familyId}/messaging`)).body.data.smsLeftThisMonth).toBe(5);
  });

  it('takes answers through the personal link, and lets people stop and restart messages', async () => {
    await announce(admin);
    await ctx.instance.announcements.idle();
    const token = tokenIn(sms.outbox[0]!.text);
    const anonymous = await new TestClient(ctx).init();
    const view = (await anonymous.post('/rsvp/view', { token })).body.data;
    expect(view).toMatchObject({ familyName: 'Apeatu Family', firstName: 'Kwame', title: 'Funeral of Nana Kofi', place: 'Larteh', answer: null, optedOut: false, closed: false });
    expect((await anonymous.post('/rsvp/answer', { token, answer: 'yes' })).body.data.answer).toBe('yes');
    expect((await admin.get(`/families/${familyId}/events/${eventId}/announcements`)).body.data[0].rsvp).toMatchObject({ yes: 1, waiting: 0 });
    expect((await anonymous.post('/rsvp/view', { token: 'x'.repeat(22) })).status).toBe(404);

    // Stopping holds for later announcements: no SMS or WhatsApp, other channels still work.
    expect((await anonymous.post('/rsvp/answer', { token, answer: 'stop' })).body.data.optedOut).toBe(true);
    const preview = (await admin.post(`/families/${familyId}/events/${eventId}/announcements/preview`, { audience: { kind: 'all' }, channels: ['sms'], message: 'Again', rsvp: false, remind: false })).body.data;
    expect(preview).toMatchObject({ bySms: 0, optedOut: 1 });
    expect((await announce(admin, { channels: ['sms'] })).status).toBe(400);
    expect((await anonymous.post('/rsvp/answer', { token, answer: 'start' })).body.data.optedOut).toBe(false);
  });

  it('is sent only by administrators, moderators and the ceremony organisers', async () => {
    const plain = await member('plain@example.org');
    expect((await announce(plain)).status).toBe(403);
    expect((await plain.get(`/families/${familyId}/events/${eventId}`)).body.data.viewerCan.announce).toBe(false);
    // Kwame's account, named in a role at the ceremony.
    const organiser = await member('kwame@example.org', 'family_member', kwame);
    const event = (await admin.get(`/families/${familyId}/events/${eventId}`)).body.data;
    await admin.patch(`/families/${familyId}/events/${eventId}`, { version: event.version, roles: [{ role: 'Chief mourner', memberId: kwame }] });
    expect((await announce(organiser, { channels: ['email'] })).status).toBe(201);
  });

  it('keeps each family within its monthly SMS limit', async () => {
    const long = 'x'.repeat(370);
    // Three parts each with the link: two sends fit in six, a third does not.
    for (let i = 0; i < 2; i++) expect((await announce(admin, { channels: ['sms'], message: long, rsvp: false, remind: false })).status).toBe(201);
    await ctx.instance.announcements.idle();
    const refused = await announce(admin, { channels: ['sms'], message: long });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/has 0 left this month/);
  });

  it('opens and signs off every message the way the family chose, so people know who it is from', async () => {
    await member('ama@example.org', 'family_member', ama);
    const family = (await admin.get(`/families/${familyId}`)).body.data;
    expect(family.messageTemplate).toEqual({ opening: '{family} announcement:', signOff: '' });
    const long = 'x'.repeat(81);
    expect((await admin.patch(`/families/${familyId}`, { version: family.version, messageTemplate: { opening: long, signOff: '' } })).status).toBe(400);
    const saved = await admin.patch(`/families/${familyId}`, { version: family.version, messageTemplate: { opening: 'From the house of {family}:', signOff: 'Abusua Panin, Opanyin Kofi' } });
    expect(saved.status).toBe(200);
    expect(saved.body.data.messageTemplate).toEqual({ opening: 'From the house of {family}:', signOff: 'Abusua Panin, Opanyin Kofi' });

    const preview = (await admin.post(`/families/${familyId}/events/${eventId}/announcements/preview`, { audience: { kind: 'all' }, channels: ['sms'], message: 'The funeral is on Saturday.', rsvp: true, remind: false })).body.data;
    expect(preview.text).toMatch(/^From the house of Apeatu Family:\nThe funeral is on Saturday\.\nAbusua Panin, Opanyin Kofi\nAre you coming\? Answer here: http/);

    await announce(admin, { channels: ['sms', 'whatsapp', 'email'] });
    await ctx.instance.announcements.idle();
    expect(sms.outbox[0]!.text).toMatch(/^From the house of Apeatu Family:\nThe funeral of Nana Kofi is on Saturday at Larteh\.\nAbusua Panin, Opanyin Kofi\nAre you coming\? Answer here: /);
    // The WhatsApp template's message part carries the opening and sign-off on one line.
    expect(whatsapp.outbox[0]!.text).toContain('From the house of Apeatu Family: The funeral of Nana Kofi is on Saturday at Larteh. Abusua Panin, Opanyin Kofi');
    const mail = ctx.mailer.outbox.find((m) => m.to === 'ama@example.org' && m.subject.startsWith('Apeatu Family'))!;
    expect(mail.subject).toBe('Apeatu Family: Funeral of Nana Kofi');
    expect(mail.text).toMatch(/^From the house of Apeatu Family:\n/);
    expect(mail.text).toContain('You are receiving this because you are in the Apeatu Family tree on Family Heritage.');
  });

  it('reminds everyone who has not declined, the day before', async () => {
    await member('ama@example.org', 'family_member', ama);
    await announce(admin, { channels: ['sms', 'email'] });
    await ctx.instance.announcements.idle();
    const doc = (await AnnouncementModel.findOne())!;
    expect(doc.remindAt).toBeInstanceOf(Date);
    // Ama says she cannot come; only Kwame is reminded.
    const amaToken = tokenIn(ctx.mailer.outbox.find((m) => m.to === 'ama@example.org' && m.subject.startsWith('Apeatu Family'))!.text);
    await (await new TestClient(ctx).init()).post('/rsvp/answer', { token: amaToken, answer: 'no' });
    sms.outbox.length = 0;
    ctx.mailer.outbox.length = 0;
    expect(await ctx.instance.announcements.runDue(new Date(doc.remindAt!.getTime() - 60_000))).toEqual({ sent: 0, reminders: 0 });
    expect(await ctx.instance.announcements.runDue(new Date(doc.remindAt!.getTime() + 60_000))).toEqual({ sent: 0, reminders: 1 });
    expect(sms.outbox).toHaveLength(1);
    expect(sms.outbox[0]!.text).toMatch(/^Apeatu Family announcement:\nReminder: Funeral of Nana Kofi is tomorrow, Larteh\./);
    expect(ctx.mailer.outbox.filter((m) => m.to === 'ama@example.org')).toHaveLength(0);
    // Only once.
    expect((await ctx.instance.announcements.runDue(new Date(doc.remindAt!.getTime() + 3_600_000))).reminders).toBe(0);
  });
});
