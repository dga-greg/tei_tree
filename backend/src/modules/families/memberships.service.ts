import mongoose, { Types } from 'mongoose';
import type { FamilyRole, MembershipView } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import type { Actor } from '../relationships/relationships.service.js';
import { UserModel } from '../users/user.model.js';
import type { FamilyAccess } from './family-access.js';
import { FamilyMembershipModel } from './membership.model.js';

/** Accounts in a family: roles, moderator branch scopes, claimed profiles, removal and leaving. */
export class MembershipsService {
  constructor(private readonly audit: AuditService) {}

  async list(access: FamilyAccess): Promise<MembershipView[]> {
    access.assert('membership.manage');
    const policy = new MemberPolicy(access);
    const rows = await FamilyMembershipModel.find({ familyId: access.familyId, status: 'active' }).sort({ role: 1, joinedAt: 1 });
    const [users, profiles] = await Promise.all([
      UserModel.find({ _id: { $in: rows.map((r) => r.userId) } }, { displayName: 1, email: 1 }).lean(),
      FamilyMemberModel.find({ _id: { $in: rows.map((r) => r.memberProfileId).filter(Boolean) }, familyId: access.familyId, deletedAt: null }),
    ]);
    const userById = new Map(users.map((u) => [u._id.toString(), u]));
    const profileById = new Map(profiles.map((p) => [p.id as string, p]));
    return rows.map((r) => {
      const u = userById.get(r.userId.toString());
      const p = r.memberProfileId ? profileById.get(r.memberProfileId.toString()) : undefined;
      return {
        id: r.id as string,
        user: { id: r.userId.toString(), displayName: u?.displayName ?? 'Unknown account', email: u?.email ?? '' },
        role: r.role,
        moderatedBranchIds: r.moderatedBranchIds.map(String),
        treasurer: r.treasurer === true,
        profile: p ? toPersonCard(p, policy) : null,
        joinedAt: r.joinedAt.toISOString(),
        isSelf: r.userId.equals(access.membership?.userId ?? new Types.ObjectId()),
      };
    });
  }

  /** A family must always keep at least one administrator. */
  private async assertNotLastAdmin(familyId: Types.ObjectId, membershipId: Types.ObjectId, session: mongoose.ClientSession): Promise<void> {
    const others = await FamilyMembershipModel.countDocuments({ familyId, role: 'family_admin', status: 'active', _id: { $ne: membershipId } }).session(session);
    if (others === 0) throw new AppError('CONFLICT', 'A family needs at least one administrator. Make someone else an administrator first.');
  }

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: { role?: FamilyRole; moderatedBranchIds?: string[]; treasurer?: boolean }): Promise<MembershipView[]> {
    access.assert('membership.manage');
    await mongoose.connection.transaction(async (session) => {
      const m = await FamilyMembershipModel.findOne({ _id: id, familyId: access.familyId, status: 'active' }).session(session);
      if (!m) throw AppError.notFound('Member');
      const before = { role: m.role, moderatedBranchIds: m.moderatedBranchIds.map(String), treasurer: m.treasurer === true };
      if (patch.treasurer !== undefined) m.treasurer = patch.treasurer;
      if (patch.role && patch.role !== m.role) {
        if (m.role === 'family_admin') await this.assertNotLastAdmin(access.familyId, m._id, session);
        m.role = patch.role;
      }
      if (patch.moderatedBranchIds) {
        const ids = [...new Set(patch.moderatedBranchIds)].map((x) => new Types.ObjectId(x));
        const found = await FamilyBranchModel.countDocuments({ _id: { $in: ids }, familyId: access.familyId, deletedAt: null }).session(session);
        if (found !== ids.length) throw new AppError('VALIDATION_FAILED', 'Choose branches of this family', [{ path: 'moderatedBranchIds', message: 'Unknown branch' }]);
        m.set('moderatedBranchIds', ids);
      }
      if (m.role !== 'family_moderator') m.set('moderatedBranchIds', []);
      await m.save({ session });
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'membership.update', targetType: 'membership', targetId: m._id, before, after: { role: m.role, moderatedBranchIds: m.moderatedBranchIds.map(String), treasurer: m.treasurer === true }, requestId: actor.requestId, ip: actor.ip },
        session,
      );
    });
    return this.list(access);
  }

  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    const self = access.membership?._id.equals(id) ?? false;
    if (!self) access.assert('membership.manage');
    await mongoose.connection.transaction(async (session) => {
      const m = await FamilyMembershipModel.findOne({ _id: id, familyId: access.familyId, status: 'active' }).session(session);
      if (!m) throw AppError.notFound('Member');
      if (m.role === 'family_admin') await this.assertNotLastAdmin(access.familyId, m._id, session);
      m.status = 'removed';
      m.memberProfileId = null;
      await m.save({ session });
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: self ? 'membership.leave' : 'membership.remove', targetType: 'membership', targetId: m._id, before: { role: m.role, userId: m.userId }, requestId: actor.requestId, ip: actor.ip },
        session,
      );
    });
  }

  /** Unlinks an account from the profile it claimed (administrators, or the person themselves). */
  async unlinkProfile(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    const self = access.membership?._id.equals(id) ?? false;
    if (!self) access.assert('membership.manage');
    const m = await FamilyMembershipModel.findOne({ _id: id, familyId: access.familyId, status: 'active' });
    if (!m?.memberProfileId) throw AppError.notFound('Linked profile');
    const before = m.memberProfileId;
    m.memberProfileId = null;
    await m.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'membership.unlink_profile', targetType: 'membership', targetId: m._id, before: { memberProfileId: before }, requestId: actor.requestId, ip: actor.ip });
  }
}
