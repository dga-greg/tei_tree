import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { AuditLogModel } from '../src/modules/audit/audit-log.model.js';
import { FamilyInvitationModel } from '../src/modules/invitations/invitation.model.js';
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
  const fam = (await admin.post('/families', { name: 'Mensah Family', founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased' } })).body.data;
  familyId = fam.id;
  kofi = fam.foundingMemberId;
  kwame = await addPerson(admin, familyId, { firstName: 'Kwame', surname: 'Mensah', birthDate: { year: 1950 } }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
});

async function verified(email: string, name = 'Relative'): Promise<TestClient> {
  const client = await registeredClient(ctx, email, name);
  await UserModel.updateOne({ email }, { emailVerifiedAt: new Date() });
  return client;
}

async function member(email: string, role = 'family_member', extra: Record<string, unknown> = {}): Promise<TestClient> {
  const client = await verified(email);
  await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email }))!._id, role, ...extra });
  return client;
}

const lastToken = (subjectStart: string) => {
  const mail = [...ctx.mailer.outbox].reverse().find((m) => m.subject.startsWith(subjectStart))!;
  return /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
};

describe('invitations', () => {
  it('invites a relative who accepts and is asked to confirm the suggested profile', async () => {
    const res = await admin.post(`/families/${familyId}/invitations`, { email: 'Kwame@Example.org', role: 'family_member', suggestedProfileId: kwame, message: 'Welcome!' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: 'kwame@example.org', status: 'pending', suggestedProfile: { firstName: 'Kwame' } });
    const token = lastToken('Ama Admin invited you');

    // Anyone holding the link can preview it — without seeing the family's people.
    const preview = await new TestClient(ctx).init().then((c) => c.post('/invitations/preview', { token }));
    expect(preview.body.data).toMatchObject({ familyName: 'Mensah Family', invitedBy: 'Ama Admin', role: 'family_member', status: 'pending', suggestedProfileName: 'Kwame Mensah' });

    const invitee = await verified('kwame@example.org', 'Kwame');
    const accepted = await invitee.post('/invitations/accept', { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({ familyId, role: 'family_member' });
    expect(accepted.body.data.claimContributionId).toBeTruthy();
    expect((await invitee.get('/families')).body.data.map((f: { name: string }) => f.name)).toEqual(['Mensah Family']);

    // Single use.
    expect((await invitee.post('/invitations/accept', { token })).status).toBe(409);
    expect((await admin.get(`/families/${familyId}/invitations`)).body.data[0].status).toBe('accepted');
  });

  it('requires the invited address; the link itself confirms it', async () => {
    await admin.post(`/families/${familyId}/invitations`, { email: 'yaw@example.org' });
    const token = lastToken('Ama Admin invited you');
    const other = await verified('someone@example.org');
    const wrong = await other.post('/invitations/accept', { token });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.message).toMatch(/sent to yaw@example.org/);
    expect((await request(ctx.instance.app).post('/api/v1/invitations/accept').send({ token })).status).toBe(403); // CSRF before auth

    // A new account that has not opened its confirmation e-mail yet: the invitation reached that inbox.
    const fresh = await registeredClient(ctx, 'yaw@example.org');
    const res = await fresh.post('/invitations/accept', { token });
    expect(res.status).toBe(200);
    expect((await UserModel.findOne({ email: 'yaw@example.org' }))!.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await fresh.get('/families')).body.data.map((f: { name: string }) => f.name)).toEqual(['Mensah Family']);
  });

  it('lists pending invitations to a confirmed address and accepts them without the link', async () => {
    await admin.post(`/families/${familyId}/invitations`, { email: 'abena@example.org', role: 'family_moderator' });
    const unconfirmed = await registeredClient(ctx, 'abena@example.org');
    expect((await unconfirmed.get('/invitations/mine')).body.data).toEqual([]);
    const pending = (await admin.get(`/families/${familyId}/invitations`)).body.data[0];
    expect((await unconfirmed.post(`/invitations/${pending.id}/accept`, {})).body.error.message).toMatch(/Confirm your e-mail/);

    await UserModel.updateOne({ email: 'abena@example.org' }, { emailVerifiedAt: new Date() });
    const mine = (await unconfirmed.get('/invitations/mine')).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: pending.id, familyName: 'Mensah Family', invitedBy: 'Ama Admin', role: 'family_moderator', status: 'pending' });

    // Only the invited address may use it.
    const other = await verified('someone@example.org');
    expect((await other.get('/invitations/mine')).body.data).toEqual([]);
    expect((await other.post(`/invitations/${pending.id}/accept`, {})).status).toBe(403);

    const joined = await unconfirmed.post(`/invitations/${pending.id}/accept`, {});
    expect(joined.body.data).toMatchObject({ familyId, role: 'family_moderator' });
    expect((await unconfirmed.get('/invitations/mine')).body.data).toEqual([]);
    expect((await unconfirmed.post(`/invitations/${pending.id}/accept`, {})).status).toBe(409);
  });

  it('expires, can be revoked, and a resent link replaces the old one', async () => {
    const created = (await admin.post(`/families/${familyId}/invitations`, { email: 'esi@example.org' })).body.data;
    const first = lastToken('Ama Admin invited you');
    await admin.post(`/families/${familyId}/invitations/${created.id}/resend`);
    const second = lastToken('Ama Admin invited you');
    const esi = await verified('esi@example.org');
    expect((await esi.post('/invitations/accept', { token: first })).status).toBe(404);

    await FamilyInvitationModel.updateOne({ _id: created.id }, { expiresAt: new Date(Date.now() - 1000) });
    expect((await esi.post('/invitations/accept', { token: second })).body.error.message).toMatch(/expired/);

    const again = (await admin.post(`/families/${familyId}/invitations`, { email: 'esi@example.org' })).body.data;
    expect((await admin.delete(`/families/${familyId}/invitations/${again.id}`)).status).toBe(204);
    expect((await esi.post('/invitations/accept', { token: lastToken('Ama Admin invited you') })).status).toBe(409);
  });

  it('is managed by administrators only and refuses existing members', async () => {
    const m = await member('m@example.org');
    expect((await m.post(`/families/${familyId}/invitations`, { email: 'x@example.org' })).status).toBe(403);
    expect((await admin.post(`/families/${familyId}/invitations`, { email: 'm@example.org' })).status).toBe(409);
  });
});

describe('proposals and review', () => {
  it('lets a member propose a correction that an administrator approves', async () => {
    const m = await member('m@example.org');
    const proposed = await m.post(`/families/${familyId}/contributions`, {
      kind: 'member.update',
      targetId: kwame,
      payload: { hometown: 'Kumasi', birthDate: { year: 1951, qualifier: 'about' } },
      note: 'His baptism card says about 1951.',
    });
    expect(proposed.status).toBe(201);
    expect(proposed.body.data).toMatchObject({ kind: 'member.update', status: 'pending', summary: 'Correct details of Kwame Mensah', stale: false });
    expect(proposed.body.data.changes.map((c: { field: string }) => c.field).sort()).toEqual(['birthDate', 'hometown']);

    const queue = (await admin.get(`/families/${familyId}/contributions`)).body.data;
    expect(queue).toHaveLength(1);
    expect(queue[0].viewerCan.review).toBe(true);
    expect((await admin.get(`/families/${familyId}/dashboard`)).body.data.stats.pendingContributions).toBe(1);

    const approved = await admin.post(`/families/${familyId}/contributions/${queue[0].id}/approve`, { note: 'Thanks!' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('approved');
    const person = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data;
    expect(person).toMatchObject({ hometown: 'Kumasi', birthDate: { year: 1951, qualifier: 'about' } });
    expect(await AuditLogModel.countDocuments({ action: 'member.update', contributionId: new Types.ObjectId(queue[0].id) })).toBe(1);
    expect(ctx.mailer.outbox.at(-1)!.subject).toMatch(/was approved/);
  });

  it('applies proposed relatives and links through the normal integrity rules', async () => {
    const m = await member('m@example.org');
    const newRelative = (await m.post(`/families/${familyId}/contributions`, {
      kind: 'member.create',
      payload: { person: { firstName: 'Yaw', surname: 'Mensah' }, links: { parents: [{ memberId: kwame, subtype: 'biological', verification: 'verified' }] } },
    })).body.data;
    expect(newRelative.summary).toBe('Add Yaw Mensah as a child');
    await admin.post(`/families/${familyId}/contributions/${newRelative.id}/approve`, {});
    const yaw = (await admin.get(`/families/${familyId}/members?q=yaw`)).body.data[0];
    expect(yaw.generation.number).toBe(3);

    // A proposed link that would create a cycle is refused at approval and stays open.
    const cycle = (await m.post(`/families/${familyId}/contributions`, { kind: 'relationship.create', payload: { type: 'parent_child', personA: yaw.id, personB: kofi, subtype: 'biological' } })).body.data;
    const refused = await admin.post(`/families/${familyId}/contributions/${cycle.id}/approve`, {});
    expect(refused.status).toBe(409);
    expect((await admin.get(`/families/${familyId}/contributions/${cycle.id}`)).body.data.status).toBe('pending');
  });

  it('supports questions, answers, rejection with a reason, and withdrawal', async () => {
    const m = await member('m@example.org');
    const c = (await m.post(`/families/${familyId}/contributions`, { kind: 'member.delete', targetId: kwame, payload: { reason: 'Duplicate entry' } })).body.data;
    const asked = await admin.post(`/families/${familyId}/contributions/${c.id}/request-clarification`, { message: 'Which record is the duplicate?' });
    expect(asked.body.data.status).toBe('needs_clarification');
    expect((await m.get(`/families/${familyId}/contributions/${c.id}`)).body.data.viewerCan).toMatchObject({ respond: true, review: false });
    const answered = await m.post(`/families/${familyId}/contributions/${c.id}/respond`, { message: 'There is a second Kwame born 1950.' });
    expect(answered.body.data.status).toBe('pending');
    expect(answered.body.data.discussion.map((d: { byName: string }) => d.byName)).toEqual(['Ama Admin', 'Relative']);
    expect((await admin.post(`/families/${familyId}/contributions/${c.id}/reject`, { note: '' })).status).toBe(400);
    expect((await admin.post(`/families/${familyId}/contributions/${c.id}/reject`, { note: 'They are different people.' })).body.data.status).toBe('rejected');

    const other = (await m.post(`/families/${familyId}/contributions`, { kind: 'member.update', targetId: kwame, payload: { hometown: 'Accra' } })).body.data;
    expect((await m.post(`/families/${familyId}/contributions/${other.id}/withdraw`)).body.data.status).toBe('withdrawn');
  });

  it('warns when the record changed after the proposal, and requires confirmation', async () => {
    const m = await member('m@example.org');
    const c = (await m.post(`/families/${familyId}/contributions`, { kind: 'member.update', targetId: kwame, payload: { hometown: 'Kumasi' } })).body.data;
    const current = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data;
    await admin.patch(`/families/${familyId}/members/${kwame}`, { version: current.version, hometown: 'Tamale' });
    expect((await admin.get(`/families/${familyId}/contributions/${c.id}`)).body.data.stale).toBe(true);
    expect((await admin.post(`/families/${familyId}/contributions/${c.id}/approve`, {})).status).toBe(409);
    expect((await admin.post(`/families/${familyId}/contributions/${c.id}/approve`, { force: true })).status).toBe(200);
  });

  it('keeps proposals private to their author and reviewers, and forbids reviewing your own', async () => {
    const m1 = await member('m1@example.org');
    const m2 = await member('m2@example.org');
    const c = (await m1.post(`/families/${familyId}/contributions`, { kind: 'member.update', targetId: kwame, payload: { hometown: 'Ho' } })).body.data;
    expect((await m2.get(`/families/${familyId}/contributions`)).body.data).toEqual([]);
    expect((await m2.get(`/families/${familyId}/contributions/${c.id}`)).status).toBe(404);
    expect((await m2.post(`/families/${familyId}/contributions/${c.id}/approve`, {})).status).toBe(404);

    const own = (await admin.post(`/families/${familyId}/contributions`, { kind: 'member.update', targetId: kwame, payload: { hometown: 'Ho' } })).body.data;
    expect((await admin.post(`/families/${familyId}/contributions/${own.id}/approve`, {})).status).toBe(403);
  });

  it('lets moderators review only within their branches', async () => {
    const ama = await addPerson(admin, familyId, { firstName: 'Ama' }, { parents: [{ memberId: kofi, subtype: 'biological', verification: 'verified' }] });
    const branches = (await admin.post(`/families/${familyId}/branches/from-founder-children`)).body.data;
    const kwameBranch = branches.find((b: { name: string }) => b.name.startsWith('Kwame')).id;
    const mod = await member('mod@example.org', 'family_moderator', { moderatedBranchIds: [new Types.ObjectId(kwameBranch)] });
    const m = await member('m@example.org');
    const inside = (await m.post(`/families/${familyId}/contributions`, { kind: 'member.update', targetId: kwame, payload: { hometown: 'Kumasi' } })).body.data;
    const outside = (await m.post(`/families/${familyId}/contributions`, { kind: 'member.update', targetId: ama, payload: { hometown: 'Accra' } })).body.data;
    expect((await mod.get(`/families/${familyId}/contributions`)).body.data.map((c: { id: string }) => c.id)).toEqual([inside.id]);
    expect((await mod.post(`/families/${familyId}/contributions/${inside.id}/approve`, {})).status).toBe(200);
    expect((await mod.post(`/families/${familyId}/contributions/${outside.id}/approve`, {})).status).toBe(404);
  });
});

describe('profile claims', () => {
  it('links an account to its profile after approval; the person can then edit their own details', async () => {
    const m = await member('kwame@example.org');
    const profile = (await m.get(`/families/${familyId}/members/${kwame}`)).body.data;
    expect(profile.viewerCan).toMatchObject({ claim: true, propose: true, update: false });
    const claim = await m.post(`/families/${familyId}/claims`, { memberId: kwame, evidence: 'This is me — born 1950 in Kumasi.' });
    expect(claim.body.data.summary).toBe('Relative says they are Kwame Mensah');
    expect((await m.post(`/families/${familyId}/claims`, { memberId: kofi })).status).toBe(409); // one open claim at a time
    expect((await admin.get(`/families/${familyId}/members/${kofi}`)).body.data.viewerCan.claim).toBe(false); // deceased founder

    await admin.post(`/families/${familyId}/contributions/${claim.body.data.id}/approve`, {});
    const own = (await m.get(`/families/${familyId}/members/${kwame}`)).body.data;
    expect(own.viewerCan).toMatchObject({ editOwn: true, claim: false });
    expect(own.version).toEqual(expect.any(Number)); // needed for direct edits of one's own details
    expect((await m.patch(`/families/${familyId}/members/${kwame}`, { version: own.version, biography: 'Teacher in Kumasi.' })).status).toBe(200);
    expect((await m.patch(`/families/${familyId}/members/${kwame}`, { version: 0, birthDate: { year: 1949 } })).status).toBe(403);
    expect((await admin.get(`/families/${familyId}/memberships`)).body.data.find((x: { user: { email: string } }) => x.user.email === 'kwame@example.org').profile.firstName).toBe('Kwame');
  });

  it('requires a confirmed e-mail address', async () => {
    const c = await registeredClient(ctx, 'new@example.org');
    await FamilyMembershipModel.create({ familyId, userId: (await UserModel.findOne({ email: 'new@example.org' }))!._id, role: 'family_member' });
    expect((await c.post(`/families/${familyId}/claims`, { memberId: kwame })).status).toBe(403);
  });
});

describe('membership management', () => {
  it('changes roles and branch scopes, protects the last administrator, and removes members', async () => {
    const m = await member('m@example.org');
    const list = (await admin.get(`/families/${familyId}/memberships`)).body.data;
    const self = list.find((x: { isSelf: boolean }) => x.isSelf);
    const other = list.find((x: { isSelf: boolean }) => !x.isSelf);

    expect((await admin.patch(`/families/${familyId}/memberships/${self.id}`, { role: 'family_member' })).status).toBe(409);
    const promoted = await admin.patch(`/families/${familyId}/memberships/${other.id}`, { role: 'family_moderator' });
    expect(promoted.body.data.find((x: { id: string }) => x.id === other.id).role).toBe('family_moderator');
    expect((await admin.patch(`/families/${familyId}/memberships/${other.id}`, { moderatedBranchIds: [new Types.ObjectId().toString()] })).status).toBe(400);
    expect((await m.get(`/families/${familyId}/memberships`)).status).toBe(403);

    expect((await admin.delete(`/families/${familyId}/memberships/${other.id}`)).status).toBe(204);
    expect((await m.get(`/families/${familyId}/members`)).status).toBe(404);
    expect((await admin.post(`/families/${familyId}/leave`)).status).toBe(409); // last admin cannot leave
  });
});

describe('audit history and restore', () => {
  it('shows changes and restores an earlier version', async () => {
    const before = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data;
    await admin.patch(`/families/${familyId}/members/${kwame}`, { version: before.version, hometown: 'Tamale', birthDate: { year: 1952, qualifier: 'about' } });
    const log = (await admin.get(`/families/${familyId}/audit?targetType=member&targetId=${kwame}`)).body.data;
    const edit = log.find((e: { action: string }) => e.action === 'member.update');
    expect(edit).toMatchObject({ targetName: 'Kwame Mensah', actor: { displayName: 'Ama Admin' }, restorable: true });
    expect(edit.changes.map((c: { field: string }) => c.field).sort()).toEqual(['birthDate', 'hometown']);

    expect((await admin.post(`/families/${familyId}/audit/${edit.id}/restore`)).status).toBe(200);
    const after = (await admin.get(`/families/${familyId}/members/${kwame}`)).body.data;
    expect(after.hometown).toBeNull();
    expect(after.birthDate).toMatchObject({ year: 1950 });
  });

  it('restores a removed person together with their links', async () => {
    const yaw = await addPerson(admin, familyId, { firstName: 'Yaw' }, { parents: [{ memberId: kwame, subtype: 'biological', verification: 'verified' }] });
    await admin.delete(`/families/${familyId}/members/${kwame}`);
    const trash = (await admin.get(`/families/${familyId}/trash/members`)).body.data;
    expect(trash.map((p: { firstName: string }) => p.firstName)).toEqual(['Kwame']);
    const res = await admin.post(`/families/${familyId}/trash/members/${kwame}/restore`);
    expect(res.body.data).toMatchObject({ relationshipsRestored: 2, relationshipsSkipped: 0 });
    expect((await admin.get(`/families/${familyId}/members/${yaw}`)).body.data.generation.number).toBe(3);
  });

  it('is for administrators only', async () => {
    const m = await member('m@example.org');
    expect((await m.get(`/families/${familyId}/audit`)).status).toBe(403);
    expect((await m.get(`/families/${familyId}/trash/members`)).status).toBe(403);
  });
});
