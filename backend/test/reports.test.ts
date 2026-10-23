import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FamilyModel } from '../src/modules/families/family.model.js';
import { FamilyMembershipModel } from '../src/modules/families/membership.model.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { addPerson, buildApp, clearDb, connectTestDb, disconnectTestDb, registeredClient, TestClient, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: TestClient;
let familyId: string;
let kofi: string;
let kwame: string;

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
  admin = await registeredClient(ctx, 'admin@example.org', 'Ama Admin');
  const fam = (await admin.post('/families', { name: 'Mensah Family', privacy: { visibility: 'public' }, founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased', privacy: { level: 'public' } } })).body.data;
  familyId = fam.id;
  kofi = fam.foundingMemberId;
  kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', vitalStatus: 'living' });
});

async function root(): Promise<TestClient> {
  const client = await registeredClient(ctx, 'root@example.org', 'Platform');
  await UserModel.updateOne({ email: 'root@example.org' }, { platformRole: 'super_admin' });
  return client;
}

describe('abuse reports', () => {
  it('lets people report what they can see, once, and only that', async () => {
    const outsider = await registeredClient(ctx, 'visitor@example.org', 'Visitor');
    const body = { familyId, targetType: 'member', targetId: kofi, reason: 'false_information', details: 'This is not my great-grandfather.' };
    expect((await outsider.post('/reports', body)).status).toBe(201);
    expect((await outsider.post('/reports', body)).status).toBe(409);
    // A living person is hidden from visitors of a public family, so cannot be reported by them.
    expect((await outsider.post('/reports', { ...body, targetId: kwame })).status).toBe(404);
    expect((await outsider.post('/reports', { ...body, details: 'short' })).status).toBe(400);
    expect((await outsider.post('/reports', { familyId, targetType: 'family', reason: 'privacy', details: 'Publishes my family without consent.' })).status).toBe(201);
    const anonymous = await new TestClient(ctx).init();
    expect((await anonymous.post('/reports', body)).status).toBe(401);

    const priv = (await outsider.post('/families', { name: 'Private Family' })).body.data;
    expect((await admin.post('/reports', { familyId: priv.id, targetType: 'family', reason: 'other', details: 'Something about this family.' })).status).toBe(404);
  });

  it('are reviewed by platform administrators, who can notify the family and suspend it', async () => {
    const reporter = await registeredClient(ctx, 'visitor@example.org', 'Visitor');
    const report = (await reporter.post('/reports', { familyId, targetType: 'member', targetId: kofi, reason: 'privacy', details: 'Shows my grandmother’s address.' })).body.data;
    expect((await admin.get('/admin/reports')).status).toBe(403);

    const platform = await root();
    const open = (await platform.get('/admin/reports')).body.data;
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ targetLabel: 'Profile of Kofi Mensah', reason: 'privacy', reporter: { email: 'visitor@example.org' }, family: { name: 'Mensah Family', status: 'active' } });

    expect((await platform.patch(`/admin/reports/${report.id}`, { status: 'resolved', resolution: '' })).status).toBe(400);
    const resolved = await platform.patch(`/admin/reports/${report.id}`, { status: 'resolved', resolution: 'Please remove the address from the biography.', notifyFamilyAdmins: true, suspendFamily: true });
    expect(resolved.body.data).toMatchObject({ status: 'resolved', actions: ['family_suspended', 'family_admins_notified'] });
    expect((await FamilyModel.findById(familyId))!.status).toBe('suspended');
    const subjects = ctx.mailer.outbox.map((m) => `${m.to}: ${m.subject}`);
    expect(subjects).toContain('admin@example.org: A report about content in the Mensah Family');
    expect(subjects).toContain('visitor@example.org: Your report has been reviewed');
    expect((await platform.patch(`/admin/reports/${report.id}`, { status: 'dismissed', resolution: 'Again' })).status).toBe(409);
    expect((await platform.get('/admin/reports?status=resolved')).body.data).toHaveLength(1);
  });

  it('keeps the report when the family is erased', async () => {
    const reporter = await registeredClient(ctx, 'visitor@example.org', 'Visitor');
    await reporter.post('/reports', { familyId, targetType: 'family', reason: 'other', details: 'Report about the whole family.' });
    await FamilyModel.updateOne({ _id: familyId }, { status: 'pending_deletion', deletionScheduledFor: new Date(Date.now() - 1000) });
    await ctx.instance.lifecycle.purge();
    expect(await FamilyMembershipModel.countDocuments({ familyId })).toBe(0);
    const platform = await root();
    const rows = (await platform.get('/admin/reports')).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ family: null, targetLabel: 'Mensah Family' });
  });
});
