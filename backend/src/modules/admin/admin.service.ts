import mongoose, { type Types } from 'mongoose';
import type { AdminFamilyView, AdminUpdateUserRequest, AdminUserView, FamilyStatus, PlatformStats } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { escapeRegex, pageMeta, type Pagination } from '../../core/validation.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthService } from '../auth/auth.service.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { UserModel } from '../users/user.model.js';
import { toAdminUserView } from '../users/user.mapper.js';

export interface ActorContext {
  userId: Types.ObjectId;
  requestId: string;
  ip: string | null;
}

/**
 * Platform administration. Deliberately has no access to genealogy records: only accounts,
 * family registration metadata and aggregate counts.
 */
export class AdminService {
  constructor(
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async stats(): Promise<PlatformStats> {
    const [total, active, suspended, families, activeFamilies] = await Promise.all([
      UserModel.countDocuments({ status: { $ne: 'deleted' } }),
      UserModel.countDocuments({ status: 'active' }),
      UserModel.countDocuments({ status: 'suspended' }),
      FamilyModel.countDocuments({}),
      FamilyModel.countDocuments({ status: 'active' }),
    ]);
    return { users: { total, active, suspended }, families: { total: families, active: activeFamilies } };
  }

  async listUsers(query: Pagination & { q?: string; status?: 'active' | 'suspended' }) {
    const filter: Record<string, unknown> = { status: query.status ?? { $ne: 'deleted' } };
    if (query.q) {
      const re = new RegExp(escapeRegex(query.q), 'i');
      filter['$or'] = [{ email: re }, { displayName: re }];
    }
    const [users, total] = await Promise.all([
      UserModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize),
      UserModel.countDocuments(filter),
    ]);
    const counts = await FamilyMembershipModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId: { $in: users.map((u) => u._id) }, status: 'active' } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
    ]);
    const countByUser = new Map(counts.map((c) => [c._id.toString(), c.n]));
    const data: AdminUserView[] = users.map((u) => toAdminUserView(u, countByUser.get(u.id as string) ?? 0));
    return { data, meta: pageMeta(query, total) };
  }

  async updateUser(actor: ActorContext, userId: Types.ObjectId, patch: AdminUpdateUserRequest): Promise<AdminUserView> {
    if (actor.userId.equals(userId)) {
      throw AppError.forbidden('You cannot change your own account status or role');
    }
    const updated = await mongoose.connection.transaction(async (session) => {
      const before = await UserModel.findOne({ _id: userId, status: { $ne: 'deleted' } }).session(session);
      if (!before) throw AppError.notFound('User');
      const after = await UserModel.findOneAndUpdate({ _id: userId }, { $set: patch }, { new: true, session });
      if (patch.status === 'suspended' && before.status !== 'suspended') {
        await this.auth.revokeAllSessions(userId, 'account_suspended', undefined, session);
      }
      await this.audit.record(
        {
          familyId: null,
          actorId: actor.userId,
          actorRole: 'super_admin',
          action: 'admin.user.update',
          targetType: 'user',
          targetId: userId,
          before: { status: before.status, platformRole: before.platformRole },
          after: { status: after!.status, platformRole: after!.platformRole },
          requestId: actor.requestId,
          ip: actor.ip,
        },
        session,
      );
      return after!;
    });
    const familyCount = await FamilyMembershipModel.countDocuments({ userId, status: 'active' });
    return toAdminUserView(updated, familyCount);
  }

  /** Registration metadata only — names, status, owner and counts, never people. */
  async listFamilies(query: Pagination & { q?: string; status?: FamilyStatus }) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter['status'] = query.status;
    if (query.q) {
      const re = new RegExp(escapeRegex(query.q), 'i');
      filter['$or'] = [{ name: re }, { slug: re }];
    }
    const [families, total] = await Promise.all([
      FamilyModel.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize),
      FamilyModel.countDocuments(filter),
    ]);
    const creators = await UserModel.find({ _id: { $in: families.map((f) => f.createdBy) } });
    const creatorById = new Map(creators.map((u) => [u.id as string, u]));
    const accounts = await FamilyMembershipModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { familyId: { $in: families.map((f) => f._id) }, status: 'active' } },
      { $group: { _id: '$familyId', n: { $sum: 1 } } },
    ]);
    const accountsByFamily = new Map(accounts.map((a) => [a._id.toString(), a.n]));
    const data: AdminFamilyView[] = families.map((f) => {
      const creator = creatorById.get(f.createdBy.toString());
      return {
        id: f.id as string,
        name: f.name,
        slug: f.slug,
        status: f.status,
        visibility: f.privacy?.visibility ?? 'private',
        createdAt: f.createdAt.toISOString(),
        createdBy: creator ? { id: creator.id as string, email: creator.email, displayName: creator.displayName } : null,
        memberCount: f.stats?.memberCount ?? 0,
        accountCount: accountsByFamily.get(f.id as string) ?? 0,
      };
    });
    return { data, meta: pageMeta(query, total) };
  }

  async updateFamilyStatus(actor: ActorContext, familyId: Types.ObjectId, status: FamilyStatus): Promise<void> {
    await mongoose.connection.transaction(async (session) => {
      const family = await FamilyModel.findById(familyId).session(session);
      if (!family) throw AppError.notFound('Family');
      const before = family.status;
      if (before === 'pending_deletion') throw new AppError('CONFLICT', 'This family is scheduled for deletion by its administrators; only they can restore it.');
      await FamilyModel.updateOne({ _id: familyId }, { $set: { status } }, { session });
      await this.audit.record(
        { familyId: null, actorId: actor.userId, actorRole: 'super_admin', action: 'admin.family.status', targetType: 'family', targetId: familyId, before: { status: before }, after: { status }, requestId: actor.requestId, ip: actor.ip },
        session,
      );
    });
  }
}
