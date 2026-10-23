import { randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { StorageProvider } from '../../infra/storage.js';
import type { AuditService } from '../audit/audit.service.js';
import { EmailVerificationTokenModel } from '../auth/email-verification.model.js';
import type { PasswordHasher } from '../auth/password.js';
import { PasswordResetTokenModel } from '../auth/password-reset.model.js';
import { AuthSessionModel } from '../auth/session.model.js';
import { FamilyContributionModel } from '../contributions/contribution.model.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { FamilyMediaModel } from '../media/media.model.js';
import type { Actor } from '../relationships/relationships.service.js';
import { FamilyStoryModel } from '../stories/story.model.js';
import { NotificationDeliveryModel, PushSubscriptionModel } from '../notifications/notifications.model.js';
import type { MfaService } from '../auth/mfa.service.js';
import { UserModel } from '../users/user.model.js';

export const deleteAccountBody = z.object({ password: z.string().min(1).max(1024).optional() }).strict();
export const deleteFamilyBody = z.object({ name: z.string().trim().min(1).max(200), password: z.string().min(1).max(1024).optional() }).strict();

/** Collections whose documents belong to one family and go when the family is purged. */
const KEPT_ON_PURGE = new Set(['AbuseReport']);

export interface LifecycleSettings {
  /** Days a family scheduled for deletion can still be restored. */
  familyGraceDays: number;
  /** Days removed files are kept (restorable) before their stored objects are deleted. */
  mediaRetentionDays: number;
}

/**
 * Account deletion, family deletion with a grace period, and the purge job that erases what is due.
 * Deleting is deliberate: it needs the password and, for a family, its exact name.
 */
export class LifecycleService {
  constructor(
    private readonly settings: LifecycleSettings,
    private readonly hasher: PasswordHasher,
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    /** Needed for the account holder's own actions; background jobs (purges) do without. */
    private readonly mfa?: MfaService,
  ) {}

  /** The password, or for accounts made with Google a recent sign-in. */
  private async checkPassword(actor: Actor, password: string | undefined): Promise<void> {
    if (!this.mfa) throw new Error('LifecycleService needs MfaService to check passwords');
    await this.mfa.confirmIdentity(actor.userId, actor.sessionId, { password }, false);
  }

  // ------------------------------------------------------------------ accounts

  /**
   * Deletes an account: personal data is erased, sessions end, memberships end. Contributions to family
   * records stay with the family (shown as by a "Former member"); unpublished additions are withdrawn.
   */
  async deleteAccount(actor: Actor, password: string | undefined): Promise<void> {
    await this.checkPassword(actor, password);
    const user = (await UserModel.findById(actor.userId))!;
    if (user.platformRole === 'super_admin' && (await UserModel.countDocuments({ platformRole: 'super_admin', status: 'active' })) <= 1) {
      throw new AppError('CONFLICT', 'You are the only platform administrator. Appoint another before deleting your account.');
    }
    const adminOf = await FamilyMembershipModel.find({ userId: actor.userId, role: 'family_admin', status: 'active' });
    const blocking: string[] = [];
    for (const m of adminOf) {
      const others = await FamilyMembershipModel.countDocuments({ familyId: m.familyId, role: 'family_admin', status: 'active', userId: { $ne: actor.userId } });
      const family = await FamilyModel.findById(m.familyId, { name: 1, status: 1 });
      if (others === 0 && family && family.status !== 'pending_deletion') blocking.push(family.name);
    }
    if (blocking.length) {
      throw new AppError('CONFLICT', `You are the only administrator of ${blocking.join(', ')}. Make someone else an administrator, or delete the family, first.`, blocking.map((name) => ({ path: 'families', message: name })));
    }

    const now = new Date();
    await mongoose.connection.transaction(async (session) => {
      await FamilyMembershipModel.updateMany({ userId: actor.userId, status: 'active' }, { $set: { status: 'removed', memberProfileId: null } }, { session });
      await AuthSessionModel.updateMany({ userId: actor.userId, revokedAt: null }, { $set: { revokedAt: now, revokedReason: 'account_deleted' } }, { session });
      await PasswordResetTokenModel.deleteMany({ userId: actor.userId }, { session });
      await EmailVerificationTokenModel.deleteMany({ userId: actor.userId }, { session });
      await PushSubscriptionModel.deleteMany({ userId: actor.userId }, { session });
      await NotificationDeliveryModel.deleteMany({ userId: actor.userId }, { session });
      await FamilyContributionModel.updateMany({ proposedBy: actor.userId, status: { $in: ['pending', 'needs_clarification'] } }, { $set: { status: 'withdrawn' } }, { session });
      await FamilyMediaModel.updateMany({ uploadedBy: actor.userId, status: { $ne: 'published' }, deletedAt: null }, { $set: { deletedAt: now, deletedBy: actor.userId } }, { session });
      await FamilyStoryModel.updateMany({ createdBy: actor.userId, status: { $ne: 'published' }, deletedAt: null }, { $set: { deletedAt: now, deletedBy: actor.userId } }, { session });
      await UserModel.updateOne(
        { _id: actor.userId },
        {
          $set: {
            email: `deleted-${actor.userId.toString()}@deleted.invalid`,
            displayName: 'Former member',
            passwordHash: await this.hasher.hash(randomBytes(32).toString('hex')),
            status: 'deleted',
            platformRole: 'user',
            emailVerifiedAt: null,
            lastLoginAt: null,
            'preferences.defaultFamilyId': null,
            notifications: { weeklyDigest: false, push: false },
            mfa: { totpSecret: null, enabledAt: null, lastUsedStep: null, recoveryCodes: [], pendingSecret: null, pendingCreatedAt: null },
            google: { sub: null, email: null, linkedAt: null },
          },
        },
        { session },
      );
      await this.audit.record({ familyId: null, actorId: actor.userId, actorRole: 'user', action: 'account.delete', targetType: 'user', targetId: actor.userId, requestId: actor.requestId, ip: actor.ip }, session);
    });
  }

  // ------------------------------------------------------------------ families

  async scheduleFamilyDeletion(access: FamilyAccess, actor: Actor, input: z.output<typeof deleteFamilyBody>): Promise<{ deletionScheduledFor: string }> {
    access.assert('family.delete');
    if (input.name !== access.family.name) {
      throw new AppError('VALIDATION_FAILED', 'Type the family name exactly as shown', [{ path: 'name', message: 'The name does not match' }]);
    }
    await this.checkPassword(actor, input.password);
    const when = new Date(Date.now() + this.settings.familyGraceDays * 86_400_000);
    access.family.set({ status: 'pending_deletion', deletionScheduledFor: when, deletionRequestedBy: actor.userId });
    await access.family.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'family.delete_scheduled', targetType: 'family', targetId: access.familyId, after: { deletionScheduledFor: when }, requestId: actor.requestId, ip: actor.ip });
    return { deletionScheduledFor: when.toISOString() };
  }

  /** Administrators of a family scheduled for deletion can bring it back during the grace period. */
  async cancelFamilyDeletion(actor: Actor, familyId: Types.ObjectId): Promise<void> {
    const family = await FamilyModel.findOne({ _id: familyId, status: 'pending_deletion' });
    const admin = family && (await FamilyMembershipModel.exists({ familyId, userId: actor.userId, role: 'family_admin', status: 'active' }));
    if (!family || !admin) throw AppError.notFound('Family');
    family.set({ status: 'active', deletionScheduledFor: null, deletionRequestedBy: null });
    await family.save();
    await this.audit.record({ familyId, actorId: actor.userId, actorRole: 'family_admin', action: 'family.delete_cancelled', targetType: 'family', targetId: familyId, requestId: actor.requestId, ip: actor.ip });
  }

  /** Families the user administers that are waiting to be deleted. */
  async scheduledDeletions(userId: Types.ObjectId): Promise<{ id: string; name: string; deletionScheduledFor: string }[]> {
    const memberships = await FamilyMembershipModel.find({ userId, role: 'family_admin', status: 'active' }, { familyId: 1 }).lean();
    const families = await FamilyModel.find({ _id: { $in: memberships.map((m) => m.familyId) }, status: 'pending_deletion' }).lean();
    return families.map((f) => ({ id: f._id.toString(), name: f.name, deletionScheduledFor: (f.deletionScheduledFor ?? new Date()).toISOString() }));
  }

  // ------------------------------------------------------------------ purge

  /**
   * Erases what is due: families whose grace period has ended (every record and stored file), and files
   * removed longer ago than the retention period. Safe to run repeatedly; returns what it did.
   */
  async purge(now = new Date()): Promise<{ families: number; files: number }> {
    let families = 0;
    for (const family of await FamilyModel.find({ status: 'pending_deletion', deletionScheduledFor: { $lte: now } })) {
      await this.purgeFamily(family._id, family.name);
      families++;
    }
    const cutoff = new Date(now.getTime() - this.settings.mediaRetentionDays * 86_400_000);
    let files = 0;
    for (const m of await FamilyMediaModel.find({ deletedAt: { $ne: null, $lte: cutoff } }).limit(5000)) {
      await this.removeObjects([m.storageKey, m.thumbKey]);
      await FamilyMediaModel.deleteOne({ _id: m._id });
      files++;
    }
    await FamilyStoryModel.deleteMany({ deletedAt: { $ne: null, $lte: cutoff } });
    if (families || files) this.logger.info({ families, files }, 'Purge completed');
    return { families, files };
  }

  private async removeObjects(keys: (string | null | undefined)[]): Promise<void> {
    for (const key of keys) {
      if (!key) continue;
      try {
        await this.storage.remove(key);
      } catch (err) {
        // Leave the record for the next run rather than lose track of an object we could not delete.
        this.logger.error({ err, key }, 'Could not delete stored file');
        throw err;
      }
    }
  }

  private async purgeFamily(familyId: Types.ObjectId, name: string): Promise<void> {
    for (const m of await FamilyMediaModel.find({ familyId })) await this.removeObjects([m.storageKey, m.thumbKey]);
    for (const modelName of mongoose.modelNames()) {
      if (KEPT_ON_PURGE.has(modelName)) continue;
      const model = mongoose.model(modelName);
      if (model.schema.path('familyId')) await model.deleteMany({ familyId });
    }
    await FamilyModel.deleteOne({ _id: familyId });
    await this.audit.record({ familyId: null, actorId: null, actorRole: 'system', action: 'family.purge', targetType: 'family', targetId: familyId, after: { name } });
  }
}
