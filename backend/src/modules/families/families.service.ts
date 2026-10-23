import mongoose, { Types, type ClientSession } from 'mongoose';
import { normalizeName, type FamilySummary } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { randomToken } from '../../core/crypto.js';
import type { AuditService } from '../audit/audit.service.js';
import { FamilyMemberModel } from '../members/member.model.js';
import type { MembersService } from '../members/members.service.js';
import { noGraphListener, type Actor, type GraphChangeListener } from '../relationships/relationships.service.js';
import { FamilyAccess } from './family-access.js';
import { FamilyModel, type FamilyDoc } from './family.model.js';
import { FamilyMembershipModel } from './membership.model.js';
import { toFamilySummary } from './family.mapper.js';
import type { CreateFamilyParsed, UpdateFamilyParsed } from './family.validators.js';

function slugify(name: string): string {
  const base = normalizeName(name).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 100);
  return base || 'family';
}

export class FamiliesService {
  private members!: MembersService;

  constructor(
    private readonly audit: AuditService,
    private readonly graph: GraphChangeListener = noGraphListener,
  ) {}

  /** Breaks the construction cycle families ↔ members (the founder is created as a member). */
  attachMembers(members: MembersService): void {
    this.members = members;
  }

  /** Families the user belongs to. Suspended/archived families stay listed so members can see why. */
  async listForUser(userId: Types.ObjectId): Promise<FamilySummary[]> {
    const memberships = await FamilyMembershipModel.find({ userId, status: 'active' });
    if (memberships.length === 0) return [];
    const families = await FamilyModel.find({ _id: { $in: memberships.map((m) => m.familyId) }, status: { $ne: 'pending_deletion' } });
    const byId = new Map(families.map((f) => [f.id as string, f]));
    return memberships
      .flatMap((m) => {
        const family = byId.get(m.familyId.toString());
        return family ? [toFamilySummary(family, m)] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async uniqueSlug(name: string, session: ClientSession): Promise<string> {
    const base = slugify(name);
    if (!(await FamilyModel.exists({ slug: base }).session(session))) return base;
    return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'x'}`;
  }

  /**
   * Registers a family. The creator becomes its first administrator; an optional founding ancestor
   * is created in the same transaction and becomes Generation 1.
   */
  async create(actor: Actor, input: CreateFamilyParsed): Promise<FamilyAccess> {
    const created = await mongoose.connection.transaction(async (session) => {
      const [family] = await FamilyModel.create(
        [
          {
            name: input.name,
            slug: await this.uniqueSlug(input.name, session),
            description: input.description ?? '',
            history: input.history ?? '',
            origin: { hometown: '', region: '', country: '', ...input.origin },
            privacy: input.privacy ?? {},
            generationPolicy: input.generationPolicy ?? {},
            ...(input.lineage ? { lineage: input.lineage } : {}),
            createdBy: actor.userId,
          },
        ],
        { session },
      );
      const [membership] = await FamilyMembershipModel.create([{ familyId: family!._id, userId: actor.userId, role: 'family_admin' }], { session });
      const access = new FamilyAccess(family!, membership!);
      await this.audit.record(
        { familyId: family!._id, actorId: actor.userId, actorRole: 'family_admin', action: 'family.create', targetType: 'family', targetId: family!._id, after: family!.toObject(), requestId: actor.requestId, ip: actor.ip },
        session,
      );
      if (input.founder) {
        const founder = await this.members.createInSession(access, actor, input.founder, session);
        await this.applyFounder(access, actor, founder._id, 'Founding ancestor registered with the family', session);
      }
      await this.refreshStats(family!._id, session);
      return { familyId: family!._id, membership: membership! };
    });
    await this.graph.request(created.familyId);
    const fresh = await FamilyModel.findById(created.familyId);
    return new FamilyAccess(fresh!, created.membership);
  }

  async update(access: FamilyAccess, actor: Actor, patch: UpdateFamilyParsed): Promise<FamilyDoc> {
    access.assert('family.update');
    if (patch.privacy || patch.generationPolicy) access.assert('family.manage_privacy');
    let policyChanged = false;
    await mongoose.connection.transaction(async (session) => {
      const family = await FamilyModel.findById(access.familyId).session(session);
      if (!family) throw AppError.notFound('Family');
      if ((family.get('version') as number) !== patch.version) {
        throw new AppError('VERSION_CONFLICT', 'The family settings were changed by someone else. Reload and try again.');
      }
      const before = family.toObject();
      if (patch.name !== undefined) family.name = patch.name;
      if (patch.description !== undefined) family.description = patch.description;
      if (patch.history !== undefined) family.history = patch.history;
      for (const [k, v] of Object.entries(patch.origin ?? {})) if (v !== undefined) family.set(`origin.${k}`, v);
      for (const [k, v] of Object.entries(patch.privacy ?? {})) if (v !== undefined) family.set(`privacy.${k}`, v);
      for (const [k, v] of Object.entries(patch.generationPolicy ?? {})) {
        if (v === undefined) continue;
        if (family.get(`generationPolicy.${k}`) !== v) policyChanged = true;
        family.set(`generationPolicy.${k}`, v);
      }
      if (patch.lineage) family.set('lineage', patch.lineage);
      if (patch.messageTemplate) family.set('messageTemplate', patch.messageTemplate);
      await family.save({ session });
      await this.audit.record(
        { familyId: family._id, actorId: actor.userId, actorRole: access.role, action: 'family.update', targetType: 'family', targetId: family._id, before, after: family.toObject(), requestId: actor.requestId, ip: actor.ip },
        session,
      );
    });
    if (policyChanged) await this.graph.request(access.familyId);
    return (await FamilyModel.findById(access.familyId))!;
  }

  async setFounder(access: FamilyAccess, actor: Actor, memberId: Types.ObjectId, reason?: string): Promise<FamilyDoc> {
    access.assert('family.set_founder');
    await mongoose.connection.transaction((session) => this.applyFounder(access, actor, memberId, reason ?? '', session));
    await this.graph.request(access.familyId);
    return (await FamilyModel.findById(access.familyId))!;
  }

  /** Makes `memberId` the founding ancestor. Generation numbers are recalculated after commit. */
  private async applyFounder(access: FamilyAccess, actor: Actor, memberId: Types.ObjectId, reason: string, session: ClientSession): Promise<void> {
    const person = await FamilyMemberModel.findOne({ _id: memberId, familyId: access.familyId, deletedAt: null }).session(session);
    if (!person) throw new AppError('VALIDATION_FAILED', 'Choose a person from this family', [{ path: 'memberId', message: 'Person not found in this family' }]);
    const family = await FamilyModel.findById(access.familyId).session(session);
    const previous = family!.foundingMemberId;
    if (previous?.equals(memberId)) return;

    // Generation overrides are relative to the founder, so they no longer apply.
    await FamilyMemberModel.updateMany({ familyId: access.familyId, 'generation.override': { $ne: null } }, { $set: { 'generation.override': null } }, { session });
    await FamilyModel.updateOne({ _id: access.familyId }, { $set: { foundingMemberId: memberId } }, { session });
    await this.audit.record(
      {
        familyId: access.familyId,
        actorId: actor.userId,
        actorRole: access.role,
        action: 'family.set_founder',
        targetType: 'family',
        targetId: access.familyId,
        before: { foundingMemberId: previous ?? null },
        after: { foundingMemberId: memberId, reason },
        requestId: actor.requestId,
        ip: actor.ip,
      },
      session,
    );
  }

  /** Recomputes the cached member counts shown on dashboards. */
  async refreshStats(familyId: Types.ObjectId, session?: ClientSession): Promise<void> {
    const [counts] = await FamilyMemberModel.aggregate<{ total: number; living: number; deceased: number; maxGeneration: number | null }>([
      { $match: { familyId, deletedAt: null } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          living: { $sum: { $cond: [{ $eq: ['$vitalStatus', 'living'] }, 1, 0] } },
          deceased: { $sum: { $cond: [{ $eq: ['$vitalStatus', 'deceased'] }, 1, 0] } },
          maxGeneration: { $max: '$generation.number' },
        },
      },
    ]).session(session ?? null);
    await FamilyModel.updateOne(
      { _id: familyId },
      {
        $set: {
          'stats.memberCount': counts?.total ?? 0,
          'stats.livingCount': counts?.living ?? 0,
          'stats.deceasedCount': counts?.deceased ?? 0,
          'stats.generationCount': counts?.maxGeneration ?? 0,
        },
        // Every change to people passes through here; caches of names (relationship finder) key on it.
        $inc: { peopleRevision: 1 },
      },
      { session },
    );
  }
}
