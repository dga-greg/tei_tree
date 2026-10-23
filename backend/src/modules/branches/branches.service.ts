import mongoose, { Types, type ClientSession } from 'mongoose';
import { displayName, type BranchView } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { iso } from '../../core/dates.js';
import type { AuditService } from '../audit/audit.service.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { noGraphListener, type Actor, type GraphChangeListener } from '../relationships/relationships.service.js';
import { FamilyBranchModel } from './branch.model.js';
import { descendantsOf, descentFilter, selfAndAncestors } from './descent.js';

type BranchDoc = InstanceType<typeof FamilyBranchModel>;

export class BranchesService {
  constructor(
    private readonly audit: AuditService,
    /** Branch statistics are recomputed together with generation numbers. */
    private readonly graph: GraphChangeListener = noGraphListener,
  ) {}

  private countAdoptive(access: FamilyAccess): boolean {
    return access.family.generationPolicy?.countAdoptive ?? true;
  }

  private async toView(access: FamilyAccess, b: BranchDoc, policy = new MemberPolicy(access)): Promise<BranchView> {
    const founder = await FamilyMemberModel.findOne({ _id: b.foundingMemberId, familyId: access.familyId, deletedAt: null });
    return {
      id: b.id as string,
      familyId: b.familyId.toString(),
      name: b.name,
      description: b.description,
      history: b.history,
      founder: founder && policy.isVisible(founder) ? toPersonCard(founder, policy) : null,
      stats: {
        descendantCount: b.stats?.descendantCount ?? 0,
        generationSpan: b.stats?.generationSpan ?? 0,
        livingCount: b.stats?.livingCount ?? 0,
        recalculatedAt: iso(b.stats?.recalculatedAt),
      },
      createdAt: b.createdAt.toISOString(),
    };
  }

  async list(access: FamilyAccess): Promise<BranchView[]> {
    access.assert('member.view');
    const branches = await FamilyBranchModel.find({ familyId: access.familyId, deletedAt: null }).sort({ name: 1 });
    const policy = new MemberPolicy(access);
    return Promise.all(branches.map((b) => this.toView(access, b, policy)));
  }

  async load(access: FamilyAccess, id: Types.ObjectId): Promise<BranchDoc> {
    const b = await FamilyBranchModel.findOne({ _id: id, familyId: access.familyId, deletedAt: null });
    if (!b) throw AppError.notFound('Branch');
    return b;
  }

  async get(access: FamilyAccess, id: Types.ObjectId): Promise<BranchView> {
    access.assert('member.view');
    return this.toView(access, await this.load(access, id));
  }

  private async createInSession(access: FamilyAccess, actor: Actor, input: { name: string; foundingMemberId: string; description?: string; history?: string }, session: ClientSession): Promise<BranchDoc> {
    const founderId = new Types.ObjectId(input.foundingMemberId);
    const person = await FamilyMemberModel.exists({ _id: founderId, familyId: access.familyId, deletedAt: null }).session(session);
    if (!person) throw new AppError('VALIDATION_FAILED', 'Choose a person from this family', [{ path: 'foundingMemberId', message: 'Person not found in this family' }]);
    if (await FamilyBranchModel.exists({ familyId: access.familyId, foundingMemberId: founderId, deletedAt: null }).session(session)) {
      throw new AppError('CONFLICT', 'This person already founds a branch');
    }
    const [branch] = await FamilyBranchModel.create(
      [{ familyId: access.familyId, name: input.name, foundingMemberId: founderId, description: input.description ?? '', history: input.history ?? '', createdBy: actor.userId }],
      { session },
    );
    await this.audit.record(
      { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'branch.create', targetType: 'branch', targetId: branch!._id, after: branch!.toObject(), requestId: actor.requestId, ip: actor.ip },
      session,
    );
    return branch!;
  }

  async create(access: FamilyAccess, actor: Actor, input: { name: string; foundingMemberId: string; description?: string; history?: string }): Promise<BranchView> {
    access.assert('branch.manage');
    const branch = await mongoose.connection.transaction((session) => this.createInSession(access, actor, input, session));
    await this.graph.request(access.familyId);
    return this.get(access, branch._id);
  }

  /** Creates one branch for each child of the founding ancestor that does not have one yet. */
  async createForFounderChildren(access: FamilyAccess, actor: Actor): Promise<BranchView[]> {
    access.assert('branch.manage');
    const founderId = access.family.foundingMemberId;
    if (!founderId) throw new AppError('CONFLICT', 'Choose a founding ancestor first');
    const edges = await RelationshipModel.find({ ...descentFilter(access.familyId, this.countAdoptive(access)), personA: founderId }, { personB: 1 }).lean();
    const children = await FamilyMemberModel.find({ _id: { $in: edges.map((e) => e.personB) }, familyId: access.familyId, deletedAt: null }).sort({ 'birthDate.sortKey': 1 });
    await mongoose.connection.transaction(async (session) => {
      for (const child of children) {
        if (await FamilyBranchModel.exists({ familyId: access.familyId, foundingMemberId: child._id, deletedAt: null }).session(session)) continue;
        await this.createInSession(access, actor, { name: `${displayName(child)} branch`, foundingMemberId: child.id as string }, session);
      }
    });
    await this.graph.request(access.familyId);
    return this.list(access);
  }

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: { name?: string; description?: string; history?: string }): Promise<BranchView> {
    access.assert('branch.manage');
    const branch = await this.load(access, id);
    const before = branch.toObject();
    if (patch.name !== undefined) branch.name = patch.name;
    if (patch.description !== undefined) branch.description = patch.description;
    if (patch.history !== undefined) branch.history = patch.history;
    await branch.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'branch.update', targetType: 'branch', targetId: branch._id, before, after: branch.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.toView(access, branch);
  }

  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    access.assert('branch.manage');
    const branch = await this.load(access, id);
    branch.deletedAt = new Date();
    branch.deletedBy = actor.userId;
    await branch.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'branch.delete', targetType: 'branch', targetId: branch._id, before: branch.toObject(), requestId: actor.requestId, ip: actor.ip });
    await this.graph.request(access.familyId);
  }

  /** People in a branch: its founding member and all their descendants. */
  async memberIds(access: FamilyAccess, branchId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const branch = await this.load(access, branchId);
    const ids = await descendantsOf(access.familyId, [branch.foundingMemberId], this.countAdoptive(access));
    return [branch.foundingMemberId, ...[...ids].map((x) => new Types.ObjectId(x))];
  }

  /** Branches a person belongs to (used to scope moderators). A person can be in several. */
  async branchIdsOf(familyId: Types.ObjectId, personId: Types.ObjectId, countAdoptive: boolean, session?: ClientSession): Promise<string[]> {
    const lineage = await selfAndAncestors(familyId, personId, countAdoptive, session);
    const branches = await FamilyBranchModel.find(
      { familyId, deletedAt: null, foundingMemberId: { $in: [...lineage].map((x) => new Types.ObjectId(x)) } },
      { _id: 1 },
    )
      .session(session ?? null)
      .lean();
    return branches.map((b) => b._id.toString());
  }

  /**
   * Branch ids of the given people, for permission checks — computed only for branch-scoped
   * moderators (everyone else is not restricted by branch).
   */
  async scopeFor(access: FamilyAccess, people: Types.ObjectId[], session?: ClientSession): Promise<string[]> {
    if (!access.isBranchScoped) return [];
    const ids = new Set<string>();
    for (const p of people) for (const b of await this.branchIdsOf(access.familyId, p, this.countAdoptive(access), session)) ids.add(b);
    return [...ids];
  }
}
