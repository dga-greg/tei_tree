import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { itemTitle, ordinal, yearlyDates } from '../src/modules/calendar/calendar.service.js';
import { addDays, isoWeek, localTime } from '../src/modules/notifications/notifications.service.js';
import { NotificationDeliveryModel, PushSubscriptionModel } from '../src/modules/notifications/notifications.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

describe('calendar arithmetic', () => {
  it('finds the yearly days in a range, keeping 29 February on the 28th in other years', () => {
    expect(yearlyDates(3, 12, '2026-01-01', '2027-12-31').map((d) => d.date)).toEqual(['2026-03-12', '2027-03-12']);
    expect(yearlyDates(2, 29, '2027-01-01', '2028-12-31').map((d) => d.date)).toEqual(['2027-02-28', '2028-02-29']);
    expect(yearlyDates(12, 31, '2026-12-30', '2027-01-02').map((d) => d.date)).toEqual(['2026-12-31']);
    expect(yearlyDates(6, 1, '2026-06-02', '2026-06-30')).toEqual([]);
  });

  it('writes titles people can read', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 80, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '80th', '101st', '111th']);
    expect(itemTitle('birthday', ['Ama Mensah'], 80)).toBe("Ama Mensah's 80th birthday");
    expect(itemTitle('remembrance', ['Kofi Mensah'], 1)).toBe('Remembering Kofi Mensah, 1 year since they passed');
    expect(itemTitle('anniversary', ['Kwame Mensah', 'Esi Mensah'], 50)).toBe("Kwame Mensah and Esi Mensah's 50th wedding anniversary");
    expect(itemTitle('birth_remembrance', ['Kofi Mensah'], 141)).toBe('Kofi Mensah would have turned 141');
  });

  it('knows local days, hours and ISO weeks in any time zone', () => {
    const now = new Date('2026-03-11T20:00:00Z');
    expect(localTime(now, 'UTC')).toEqual({ date: '2026-03-11', hour: 20, weekday: 3 });
    expect(localTime(now, 'Pacific/Auckland')).toEqual({ date: '2026-03-12', hour: 9, weekday: 4 });
    expect(localTime(now, 'Africa/Accra')).toMatchObject({ date: '2026-03-11', hour: 20 });
    expect(isoWeek('2026-03-09')).toBe('2026-W11');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(addDays('2026-02-26', 6)).toBe('2026-03-04');
  });
});

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let people: Record<string, string>;

async function member(email: string, name: string, role = 'family_member'): Promise<TestClient> {
  const client = await registeredClient(ctx, email, name);
  await UserModel.updateOne({ email }, { emailVerifiedAt: new Date() });
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role });
  return client;
}

const titles = (res: { body: { data: { title: string }[] } }) => res.body.data.map((i) => i.title);

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
  ctx.mailer.outbox.length = 0;
  ctx.push.sent.length = 0;
  admin = await registeredClient(ctx, 'admin@example.org', 'Ama Admin');
  await UserModel.updateOne({ email: 'admin@example.org' }, { emailVerifiedAt: new Date() });
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1885, qualifier: 'about' }, deathDate: { year: 1962, month: 1, day: 5 } } })).body.data;
  familyId = fam.id;
  const kofi = fam.foundingMemberId;
  const kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', gender: 'male', vitalStatus: 'living', birthDate: { year: 1950, month: 3, day: 12 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
  const esi = await addPerson(admin, familyId, { firstName: 'Esi', surname: 'Mensah', gender: 'female', vitalStatus: 'living', birthDate: { year: 1952, month: 7, day: 4 }, privacy: { level: 'family', hideDates: true } }, { partners: [{ memberId: kwame, subtype: 'marriage', verification: 'verified' }] });
  const yaw = await addPerson(admin, familyId, { firstName: 'Yaw', surname: 'Mensah', vitalStatus: 'living', birthDate: { year: 2016, month: 3, day: 14 } }, { parents: [{ memberId: kwame, subtype: 'biological', verification: 'verified' }] });
  // The couple's wedding date is on the link.
  const link = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data.relatives.partners[0];
  await admin.patch(`/families/${familyId}/relationships/${link.relationshipId}`, { startDate: { year: 1976, month: 3, day: 13 }, version: 0 });
  await admin.post(`/families/${familyId}/events`, { kind: 'reunion', title: 'Family reunion in Kumasi', date: { year: 2026, month: 3, day: 15 }, place: 'Kumasi', memberIds: [kwame], privacy: 'family' });
  people = { kofi, kwame, esi, yaw };
});

describe('family calendar', () => {
  it('lists birthdays, anniversaries, remembrance days and events for a range', async () => {
    const res = await admin.get(`/families/${familyId}/calendar?from=2026-01-01&to=2026-03-31`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((i: { date: string; kind: string }) => `${i.date} ${i.kind}`)).toEqual([
      '2026-01-05 remembrance',
      '2026-03-12 birthday',
      '2026-03-13 anniversary',
      '2026-03-14 birthday',
      '2026-03-15 event',
    ]);
    expect(titles(res)).toEqual([
      'Remembering Kofi Mensah, 64 years since they passed',
      "Kwame Mensah's 76th birthday",
      "Kwame Mensah and Esi Mensah's 50th wedding anniversary",
      "Yaw Mensah's 10th birthday",
      'Family reunion in Kumasi',
    ]);
    expect(res.body.data[4]).toMatchObject({ place: 'Kumasi', people: [{ id: people['kwame'] }] });
  });

  it("follows each viewer's view of the profiles", async () => {
    const m = await member('m@example.org', 'Mary Member');
    const res = await m.get(`/families/${familyId}/calendar?from=2026-01-01&to=2026-12-31`);
    // Members see neither a child's birthday nor dates someone chose to hide (and so not that couple's anniversary).
    expect(titles(res)).toEqual(['Remembering Kofi Mensah, 64 years since they passed', "Kwame Mensah's 76th birthday", 'Family reunion in Kumasi']);
    expect((await admin.get(`/families/${familyId}/calendar?from=2026-07-01&to=2026-07-31`)).body.data.map((i: { title: string }) => i.title)).toEqual(["Esi Mensah's 74th birthday"]);
    expect((await new TestClient(ctx).init().then((c) => c.get(`/families/${familyId}/calendar?from=2026-01-01&to=2026-01-31`))).status).toBe(404);
    expect((await admin.get(`/families/${familyId}/calendar?from=2026-01-01&to=2027-06-01`)).status).toBe(400);
    expect((await admin.get(`/families/${familyId}/calendar?from=2026-02-01&to=2026-01-01`)).status).toBe(400);
  });
});

describe('notification preferences and devices', () => {
  it('has sensible defaults and validates changes', async () => {
    const prefs = (await admin.get('/notifications/preferences')).body.data;
    expect(prefs).toEqual({ weeklyDigest: true, push: false, kinds: { birthday: true, remembrance: true, birth_remembrance: false, anniversary: true, event: true }, timezone: 'UTC' });
    expect((await admin.put('/notifications/preferences', { ...prefs, timezone: 'Mars/Olympus' })).status).toBe(400);
    const saved = await admin.put('/notifications/preferences', { ...prefs, timezone: 'Africa/Accra', kinds: { ...prefs.kinds, event: false } });
    expect(saved.body.data).toMatchObject({ timezone: 'Africa/Accra', kinds: { event: false } });
  });

  it('accepts only real push services, and sends test notifications', async () => {
    expect((await admin.get('/notifications/push')).body.data).toEqual({ publicKey: 'BTestPublicKeyForTestsOnly', devices: 0 });
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    for (const endpoint of ['http://fcm.googleapis.com/fcm/send/x', 'https://localhost/push', 'https://169.254.169.254/latest', 'https://evil.example/fcm.googleapis.com']) {
      expect((await admin.post('/notifications/push/subscriptions', { endpoint, keys })).status).toBe(400);
    }
    const ok = await admin.post('/notifications/push/subscriptions', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys });
    expect(ok.status).toBe(201);
    expect(ok.body.data.devices).toBe(1);
    expect((await admin.get('/notifications/preferences')).body.data.push).toBe(true);
    expect((await admin.post('/notifications/push/test')).body.data).toEqual({ sent: 1 });
    expect(ctx.push.sent[0]).toMatchObject({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', message: { body: 'Notifications are working on this device.' } });
    expect((await admin.post('/notifications/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' })).body.data.devices).toBe(0);
  });
});

describe('reminders', () => {
  it('sends the weekly e-mail once a week, in the morning where the person lives', async () => {
    const run = (iso: string) => ctx.instance.notifications.run(new Date(iso));
    // Monday 9 March 2026, 06:00 UTC: too early.
    expect(await run('2026-03-09T06:00:00Z')).toEqual({ digests: 0, pushes: 0 });
    expect(await run('2026-03-09T08:00:00Z')).toMatchObject({ digests: 1 });
    expect(await run('2026-03-09T09:00:00Z')).toMatchObject({ digests: 0 });
    const mail = ctx.mailer.outbox.at(-1)!;
    expect(mail).toMatchObject({ to: 'admin@example.org', subject: 'This week in the Mensah Family' });
    expect(mail.text).toContain("Thu 12 Mar: Kwame Mensah's 76th birthday");
    expect(mail.text).toContain('Sun 15 Mar: Family reunion in Kumasi');
    expect(mail.text).toContain('Added last week: 4 people.');
    expect(mail.text).toContain('http://localhost:4200/calendar');
    // Preview in settings says the same.
    expect((await admin.get('/notifications/digest/preview')).body.data).toMatchObject({ hasContent: true });

    // Turned off, or without a verified address: nothing.
    await admin.put('/notifications/preferences', { weeklyDigest: false, push: false, kinds: { birthday: true, remembrance: true, birth_remembrance: false, anniversary: true, event: true }, timezone: 'UTC' });
    expect(await run('2026-03-16T08:00:00Z')).toMatchObject({ digests: 0 });
    await member('unverified@example.org', 'Una');
    await UserModel.updateOne({ email: 'unverified@example.org' }, { emailVerifiedAt: null });
    expect(await run('2026-03-16T09:00:00Z')).toMatchObject({ digests: 0 });
  });

  it('sends the morning notification once a day in each time zone, and forgets devices that unsubscribed', async () => {
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    await admin.post('/notifications/push/subscriptions', { endpoint: 'https://fcm.googleapis.com/fcm/send/phone', keys });
    await admin.post('/notifications/push/subscriptions', { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/laptop', keys });
    const prefs = (await admin.get('/notifications/preferences')).body.data;
    await admin.put('/notifications/preferences', { ...prefs, weeklyDigest: false, timezone: 'Pacific/Auckland' });

    // 11 March 20:00 UTC is 12 March 09:00 in Auckland: Kwame's birthday.
    expect(await ctx.instance.notifications.run(new Date('2026-03-11T20:00:00Z'))).toEqual({ digests: 0, pushes: 1 });
    expect(ctx.push.sent.map((s) => s.message)).toEqual([
      { title: 'Today in the Mensah Family', body: "Kwame Mensah's 76th birthday", url: '/calendar', tag: 'today' },
      { title: 'Today in the Mensah Family', body: "Kwame Mensah's 76th birthday", url: '/calendar', tag: 'today' },
    ]);
    expect(await ctx.instance.notifications.run(new Date('2026-03-11T21:00:00Z'))).toMatchObject({ pushes: 0 });

    // The next day one device has unsubscribed in the browser: it is removed.
    ctx.push.gone.add('https://fcm.googleapis.com/fcm/send/phone');
    expect(await ctx.instance.notifications.run(new Date('2026-03-12T20:00:00Z'))).toMatchObject({ pushes: 1 });
    expect(await PushSubscriptionModel.countDocuments()).toBe(1);
    expect(await NotificationDeliveryModel.countDocuments({ kind: 'push' })).toBe(2);
    // A day with nothing on it sends nothing.
    expect(await ctx.instance.notifications.run(new Date('2026-03-20T20:00:00Z'))).toMatchObject({ pushes: 0 });
  });
});
