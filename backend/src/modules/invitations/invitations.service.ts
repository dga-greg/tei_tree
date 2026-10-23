import mongoose, { Types } from 'mongoose';
import { FAMILY_ROLE_LABELS, type AcceptInvitationResult, type FamilyRole, type InvitationPreview, type InvitationStatus, type InvitationView, type PendingInvitation } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { addDays } from '../../core/dates.js';
import { randomToken, sha256 } from '../../core/crypto.js';
import type { EmailDispatcher } from '../../infra/queues.js';
import type { AuditService } from '../audit/audit.service.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import type { Actor } from '../relationships/relationships.service.js';
import { UserModel } from '../users/user.model.js';
import { FamilyInvitationModel } from './invitation.model.js';
import { invitationEmail } from './invitation.emails.js';

const INVITATION_TTL_DAYS = 14;
const RETENTION_DAYS = 90;
const MAX_PENDING_PER_FAMILY = 200;

type InvitationDoc = InstanceType<typeof FamilyInvitationModel>;

/** Called when an accepted invitation suggested a profile: files a claim for review. */
export interface ClaimFiler {
  fileClaim(familyId: Types.ObjectId, userId: Types.ObjectId, memberId: Types.ObjectId, note: string, requestId: string): Promise<Types.ObjectId | null>;
}

function statusOf(i: InvitationDoc): InvitationStatus {
  return i.status === 'pending' && i.expiresAt <= new Date() ? 'expired' : i.status;
}

export class InvitationsService {
  private claims: ClaimFiler | null = null;

  constructor(
    private readonly appOrigin: string,
    private readonly email: EmailDispatcher,
    private readonly audit: AuditService,
  ) {}

  attachClaims(claims: ClaimFiler): void {
    this.claims = claims;
  }

  private async view(access: FamilyAccess, i: InvitationDoc): Promise<InvitationView> {
    const policy = new MemberPolicy(access);
    const [profile, inviter] = await Promise.all([
      i.suggestedProfileId ? FamilyMemberModel.findOne({ _id: i.suggestedProfileId, familyId: access.familyId, deletedAt: null }) : null,
      UserModel.findById(i.invitedBy, { displayName: 1 }).lean(),
    ]);
    return {
      id: i.id as string,
      email: i.email,
      role: i.role,
      status: statusOf(i),
      suggestedProfile: profile ? toPersonCard(profile, policy) : null,
      message: i.message,
      invitedBy: inviter?.displayName ?? null,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
    };
  }

  async list(access: FamilyAccess): Promise<InvitationView[]> {
    access.assert('invitation.manage');
    const rows = await FamilyInvitationModel.find({ familyId: access.familyId }).sort({ createdAt: -1 }).limit(500);
    return Promise.all(rows.map((r) => this.view(access, r)));
  }

  private send(access: FamilyAccess, i: InvitationDoc, token: string, inviterName: string): void {
    const url = new URL('/invitations/accept', this.appOrigin);
    url.searchParams.set('token', token);
    this.email.dispatch(
      invitationEmail({ to: i.email, familyName: access.family.name, inviter: inviterName, roleLabel: FAMILY_ROLE_LABELS[i.role], message: i.message, url: url.toString(), expires: i.expiresAt }),
    );
  }

  async create(access: FamilyAccess, actor: Actor, input: { email: string; role: FamilyRole; suggestedProfileId?: string | null; message?: string }): Promise<InvitationView> {
    access.assert('invitation.manage');
    const familyId = access.familyId;
    const existingUser = await UserModel.findOne({ email: input.email }, { _id: 1 }).lean();
    if (existingUser && (await FamilyMembershipModel.exists({ familyId, userId: existingUser._id, status: 'active' }))) {
      throw new AppError('CONFLICT', 'This person is already a member of the family');
    }
    if ((await FamilyInvitationModel.countDocuments({ familyId, status: 'pending', expiresAt: { $gt: new Date() } })) >= MAX_PENDING_PER_FAMILY) {
      throw new AppError('CONFLICT', 'Too many open invitations. Revoke unused ones first.');
    }
    if (input.suggestedProfileId) {
      const ok = await FamilyMemberModel.exists({ _id: input.suggestedProfileId, familyId, deletedAt: null });
      if (!ok) throw new AppError('VALIDATION_FAILED', 'Choose a person from this family', [{ path: 'suggestedProfileId', message: 'Person not found' }]);
    }
    // A new invitation to the same address replaces any open one.
    await FamilyInvitationModel.updateMany({ familyId, email: input.email, status: 'pending' }, { $set: { status: 'revoked' } });
    const token = randomToken();
    const expiresAt = addDays(new Date(), INVITATION_TTL_DAYS);
    const invitation = await FamilyInvitationModel.create({
      familyId,
      email: input.email,
      tokenHash: sha256(token),
      role: input.role,
      suggestedProfileId: input.suggestedProfileId ? new Types.ObjectId(input.suggestedProfileId) : null,
      message: input.message ?? '',
      invitedBy: actor.userId,
      expiresAt,
      purgeAt: addDays(expiresAt, RETENTION_DAYS),
    });
    await this.audit.record({ familyId, actorId: actor.userId, actorRole: access.role, action: 'invitation.create', targetType: 'invitation', targetId: invitation._id, after: { email: input.email, role: input.role }, requestId: actor.requestId, ip: actor.ip });
    const inviter = await UserModel.findById(actor.userId, { displayName: 1 }).lean();
    this.send(access, invitation, token, inviter?.displayName ?? 'A relative');
    return this.view(access, invitation);
  }

  /** Issues a fresh link (the old one stops working) and e-mails it again. */
  async resend(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<InvitationView> {
    access.assert('invitation.manage');
    const i = await FamilyInvitationModel.findOne({ _id: id, familyId: access.familyId });
    if (!i) throw AppError.notFound('Invitation');
    if (i.status !== 'pending') throw new AppError('CONFLICT', 'Only open invitations can be sent again');
    const token = randomToken();
    i.tokenHash = sha256(token);
    i.expiresAt = addDays(new Date(), INVITATION_TTL_DAYS);
    i.purgeAt = addDays(i.expiresAt, RETENTION_DAYS);
    await i.save();
    const inviter = await UserModel.findById(actor.userId, { displayName: 1 }).lean();
    this.send(access, i, token, inviter?.displayName ?? 'A relative');
    return this.view(access, i);
  }

  async revoke(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    access.assert('invitation.manage');
    const res = await FamilyInvitationModel.updateOne({ _id: id, familyId: access.familyId, status: 'pending' }, { $set: { status: 'revoked' } });
    if (!res.matchedCount) throw AppError.notFound('Open invitation');
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'invitation.revoke', targetType: 'invitation', targetId: id, requestId: actor.requestId, ip: actor.ip });
  }

  private async byToken(token: string): Promise<InvitationDoc> {
    const i = await FamilyInvitationModel.findOne({ tokenHash: sha256(token) });
    if (!i) throw new AppError('NOT_FOUND', 'This invitation link is not valid. Ask the family administrator for a new one.');
    return i;
  }

  /** Public: what the invitation is for. Shows nothing about the family's people. */
  async preview(token: string): Promise<InvitationPreview> {
    return this.describe(await this.byToken(token));
  }

  private async describe(i: InvitationDoc): Promise<InvitationPreview> {
    const [family, inviter, profile] = await Promise.all([
      FamilyModel.findById(i.familyId, { name: 1, origin: 1 }).lean(),
      UserModel.findById(i.invitedBy, { displayName: 1 }).lean(),
      i.suggestedProfileId ? FamilyMemberModel.findById(i.suggestedProfileId, { firstName: 1, preferredName: 1, surname: 1 }).lean() : null,
    ]);
    if (!family) throw AppError.notFound('Invitation');
    return {
      familyName: family.name,
      familyOrigin: [family.origin?.hometown, family.origin?.region, family.origin?.country].filter(Boolean).join(', '),
      invitedBy: inviter?.displayName ?? 'A relative',
      role: i.role,
      message: i.message,
      email: i.email,
      expiresAt: i.expiresAt.toISOString(),
      status: statusOf(i),
      suggestedProfileName: profile ? [profile.preferredName || profile.firstName, profile.surname].filter(Boolean).join(' ') : null,
    };
  }

  /**
   * Accepts an invitation from its link for the signed-in account, which must use the address invited, so a
   * forwarded link cannot be used by someone else. The link reached that inbox, so it also confirms the address.
   */
  async accept(token: string, actor: Actor): Promise<AcceptInvitationResult> {
    const i = await this.byToken(token);
    const user = await this.invitee(i, actor);
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await user.save();
    }
    return this.join(i, user, actor);
  }

  /** Pending invitations to the signed-in person's confirmed address, so they can join without the e-mail. */
  async mine(actor: Actor): Promise<PendingInvitation[]> {
    const user = await UserModel.findById(actor.userId, { email: 1, emailVerifiedAt: 1 }).lean();
    if (!user?.emailVerifiedAt) return [];
    const [invitations, memberships] = await Promise.all([
      FamilyInvitationModel.find({ email: user.email, status: 'pending', expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(20),
      FamilyMembershipModel.find({ userId: user._id, status: 'active' }, { familyId: 1 }).lean(),
    ]);
    const joined = new Set(memberships.map((m) => m.familyId.toString()));
    const open = invitations.filter((i) => !joined.has(i.familyId.toString()));
    const views = await Promise.all(open.map(async (i) => ({ id: i.id as string, ...(await this.describe(i).catch(() => null)) })));
    return views.filter((v): v is PendingInvitation => 'familyName' in v && !!v.familyName);
  }

  /** Accepts one of `mine()`: the address is confirmed and is the one invited. */
  async acceptMine(id: Types.ObjectId, actor: Actor): Promise<AcceptInvitationResult> {
    const i = await FamilyInvitationModel.findById(id);
    if (!i) throw AppError.notFound('Invitation');
    const user = await this.invitee(i, actor);
    if (!user.emailVerifiedAt) throw new AppError('FORBIDDEN', 'Confirm your e-mail address first — we sent you a link when you registered.');
    return this.join(i, user, actor);
  }

  private async invitee(i: InvitationDoc, actor: Actor) {
    const status = statusOf(i);
    if (status !== 'pending') throw new AppError('CONFLICT', status === 'expired' ? 'This invitation has expired. Ask for a new one.' : `This invitation has been ${status}.`);
    const user = await UserModel.findById(actor.userId);
    if (!user) throw AppError.unauthenticated();
    if (user.email !== i.email) {
      throw new AppError('FORBIDDEN', `This invitation was sent to ${i.email}. Sign in with that address to accept it.`);
    }
    return user;
  }

  private async join(i: InvitationDoc, user: { _id: Types.ObjectId }, actor: Actor): Promise<AcceptInvitationResult> {
    await mongoose.connection.transaction(async (session) => {
      const claimed = await FamilyInvitationModel.findOneAndUpdate(
        { _id: i._id, status: 'pending' },
        { $set: { status: 'accepted', acceptedBy: user._id, acceptedAt: new Date() } },
        { new: true, session },
      );
      if (!claimed) throw new AppError('CONFLICT', 'This invitation has already been used.');
      const existing = await FamilyMembershipModel.findOne({ familyId: i.familyId, userId: user._id }).session(session);
      if (existing?.status === 'active') throw new AppError('CONFLICT', 'You are already a member of this family.');
      if (existing) {
        existing.status = 'active';
        existing.role = i.role;
        existing.moderatedBranchIds = [];
        existing.memberProfileId = null;
        existing.invitedBy = i.invitedBy;
        existing.joinedAt = new Date();
        await existing.save({ session });
      } else {
        await FamilyMembershipModel.create([{ familyId: i.familyId, userId: user._id, role: i.role, invitedBy: i.invitedBy }], { session });
      }
      await this.audit.record(
        { familyId: i.familyId, actorId: user._id, actorRole: i.role, action: 'invitation.accept', targetType: 'invitation', targetId: i._id, after: { role: i.role }, requestId: actor.requestId, ip: actor.ip },
        session,
      );
    });

    let claimContributionId: Types.ObjectId | null = null;
    if (i.suggestedProfileId && this.claims) {
      claimContributionId = await this.claims.fileClaim(i.familyId, user._id, i.suggestedProfileId, 'Suggested by the invitation', actor.requestId);
    }
    return { familyId: i.familyId.toString(), role: i.role, claimContributionId: claimContributionId?.toString() ?? null };
  }
}
