import mongoose, { Types, type ClientSession } from 'mongoose';
import { AppError } from '../../core/errors.js';
import type { AuditService } from '../audit/audit.service.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { RelationshipModel, type RelationshipDoc } from './relationship.model.js';
import type { CreateRelationshipParsed, UpdateRelationshipParsed } from './relationship.validators.js';

export interface Actor {
  userId: Types.ObjectId;
  requestId: string;
  ip: string | null;
  /** The signed-in session, for checks that need a recent sign-in. */
  sessionId?: Types.ObjectId;
  /** Set when the change applies an approved contribution; recorded in the audit log. */
  contributionId?: Types.ObjectId;
}

const MAX_BIOLOGICAL_PARENTS = 2;
const live = { deletedAt: null };

/**
 * Creates and changes edges of the genealogy graph, enforcing the integrity rules in
 * docs/02-DATA-MODEL.md §2.1 inside a transaction.
 */
/** Notified after a committed change that can affect generation numbers. */
export interface GraphChangeListener {
  request(familyId: Types.ObjectId): Promise<void>;
}

export const noGraphListener: GraphChangeListener = { request: async () => undefined };

/** Resolves the branches of people, for branch-scoped moderators. */
export interface BranchScope {
  scopeFor(access: FamilyAccess, people: Types.ObjectId[], session?: ClientSession): Promise<string[]>;
}

export class RelationshipsService {
  constructor(
    private readonly audit: AuditService,
    private readonly graph: GraphChangeListener = noGraphListener,
    private readonly branchScope?: BranchScope,
  ) {}

  /** A moderator may link people when at least one of them is in their branches. */
  private async assertManage(access: FamilyAccess, people: Types.ObjectId[]): Promise<void> {
    const branchIds = this.branchScope ? await this.branchScope.scopeFor(access, people) : [];
    access.assert('relationship.manage', { branchIds });
  }

  /** Serialises relationship writes per family: concurrent transactions conflict on this update. */
  private async lockGraph(familyId: Types.ObjectId, session: ClientSession): Promise<void> {
    await FamilyModel.updateOne({ _id: familyId }, { $inc: { graphRevision: 1 } }, { session });
  }

  private async assertPeople(familyId: Types.ObjectId, ids: Types.ObjectId[], session: ClientSession): Promise<void> {
    const found = await FamilyMemberModel.countDocuments({ _id: { $in: ids }, familyId, ...live }, { session });
    if (found !== new Set(ids.map(String)).size) {
      throw new AppError('VALIDATION_FAILED', 'Both people must exist in this family', [{ path: 'personB', message: 'Person not found in this family' }]);
    }
  }

  /** True when `descendantCandidate` is reachable from `ancestor` by parent→child edges of any kind. */
  async isDescendant(familyId: Types.ObjectId, ancestor: Types.ObjectId, descendantCandidate: Types.ObjectId, session?: ClientSession): Promise<boolean> {
    const [result] = await RelationshipModel.aggregate<{ found: number }>([
      { $match: { familyId, type: 'parent_child', personA: ancestor, ...live } },
      {
        $graphLookup: {
          from: RelationshipModel.collection.name,
          startWith: '$personB',
          connectFromField: 'personB',
          connectToField: 'personA',
          as: 'below',
          restrictSearchWithMatch: { familyId, type: 'parent_child', deletedAt: null },
        },
      },
      {
        $project: {
          hit: { $or: [{ $eq: ['$personB', descendantCandidate] }, { $in: [descendantCandidate, '$below.personB'] }] },
        },
      },
      { $match: { hit: true } },
      { $count: 'found' },
    ]).session(session ?? null);
    return (result?.found ?? 0) > 0;
  }

  private async checkParentChild(familyId: Types.ObjectId, parent: Types.ObjectId, child: Types.ObjectId, subtype: string, session: ClientSession, ignoreId?: Types.ObjectId) {
    if (parent.equals(child)) throw new AppError('VALIDATION_FAILED', 'A person cannot be their own parent', [{ path: 'personB', message: 'Choose a different person' }]);
    if (await this.isDescendant(familyId, child, parent, session)) {
      throw new AppError('CONFLICT', 'This link would make someone their own ancestor. Check the direction of the relationship.');
    }
    const partners = await RelationshipModel.exists({ familyId, type: 'partnership', ...sortedPair(parent, child), ...live }).session(session);
    if (partners) throw new AppError('CONFLICT', 'These two people are recorded as partners and cannot also be parent and child.');
    if (subtype === 'biological') {
      const biological = await RelationshipModel.countDocuments(
        { familyId, type: 'parent_child', personB: child, subtype: 'biological', ...live, ...(ignoreId ? { _id: { $ne: ignoreId } } : {}) },
        { session },
      );
      if (biological >= MAX_BIOLOGICAL_PARENTS) {
        throw new AppError('CONFLICT', 'This person already has two biological parents. Record other parents as adoptive, step, foster or guardian.');
      }
    }
  }

  private async checkPartnership(familyId: Types.ObjectId, a: Types.ObjectId, b: Types.ObjectId, session: ClientSession) {
    if (a.equals(b)) throw new AppError('VALIDATION_FAILED', 'A person cannot partner themselves', [{ path: 'personB', message: 'Choose a different person' }]);
    const parentLink = await RelationshipModel.exists({
      familyId,
      type: 'parent_child',
      $or: [
        { personA: a, personB: b },
        { personA: b, personB: a },
      ],
      ...live,
    }).session(session);
    if (parentLink) throw new AppError('CONFLICT', 'These two people are recorded as parent and child and cannot also be partners.');
  }

  /** Inserts an edge inside an existing transaction. Used directly by member creation. */
  async createInSession(access: FamilyAccess, actor: Actor, input: CreateRelationshipParsed, session: ClientSession): Promise<RelationshipDoc> {
    const familyId = access.familyId;
    let personA = new Types.ObjectId(input.personA);
    let personB = new Types.ObjectId(input.personB);
    if (input.type === 'partnership') ({ personA, personB } = sortedPair(personA, personB));

    await this.lockGraph(familyId, session);
    await this.assertPeople(familyId, [personA, personB], session);
    if (input.type === 'parent_child') await this.checkParentChild(familyId, personA, personB, input.subtype, session);
    else await this.checkPartnership(familyId, personA, personB, session);

    const duplicate = await RelationshipModel.exists({ familyId, type: input.type, personA, personB, ...live }).session(session);
    if (duplicate) throw new AppError('CONFLICT', 'This relationship is already recorded. Edit the existing one instead.');

    const [edge] = await RelationshipModel.create(
      [
        {
          familyId,
          type: input.type,
          personA,
          personB,
          subtype: input.subtype,
          status: input.type === 'partnership' ? (input.status ?? 'current') : undefined,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          verification: input.verification,
          notes: input.notes ?? '',
          sources: input.sources ?? [],
          createdBy: actor.userId,
        },
      ],
      { session },
    );
    await this.audit.record(
      {
        familyId,
        actorId: actor.userId,
        actorRole: access.role,
        action: 'relationship.create',
        targetType: 'relationship',
        targetId: edge!._id,
        after: edge!.toObject(),
        contributionId: actor.contributionId ?? null,
        requestId: actor.requestId,
        ip: actor.ip,
      },
      session,
    );
    return edge!;
  }

  async create(access: FamilyAccess, actor: Actor, input: CreateRelationshipParsed): Promise<RelationshipDoc> {
    await this.assertManage(access, [new Types.ObjectId(input.personA), new Types.ObjectId(input.personB)]);
    const edge = await mongoose.connection.transaction((session) => this.createInSession(access, actor, input, session));
    await this.graph.request(access.familyId);
    return edge;
  }

  private async load(access: FamilyAccess, id: Types.ObjectId, session?: ClientSession): Promise<RelationshipDoc> {
    const edge = await RelationshipModel.findOne({ _id: id, familyId: access.familyId, ...live }).session(session ?? null);
    if (!edge) throw AppError.notFound('Relationship');
    return edge;
  }

  async get(access: FamilyAccess, id: Types.ObjectId): Promise<RelationshipDoc> {
    const edge = await this.load(access, id);
    await this.assertManage(access, [edge.personA, edge.personB]);
    return edge;
  }

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: UpdateRelationshipParsed): Promise<RelationshipDoc> {
    const existing = await this.load(access, id);
    await this.assertManage(access, [existing.personA, existing.personB]);
    const updated = await mongoose.connection.transaction(async (session) => {
      await this.lockGraph(access.familyId, session);
      const edge = await this.load(access, id, session);
      if ((edge.get('version') as number) !== patch.version) {
        throw new AppError('VERSION_CONFLICT', 'This relationship was changed by someone else. Reload and try again.');
      }
      const before = edge.toObject();
      if (patch.subtype && patch.subtype !== edge.subtype) {
        if (edge.type === 'parent_child') {
          await this.checkParentChild(access.familyId, edge.personA, edge.personB, patch.subtype, session, edge._id);
        }
        edge.subtype = patch.subtype;
      }
      if (patch.status !== undefined) {
        if (edge.type !== 'partnership') throw new AppError('VALIDATION_FAILED', 'Only partnerships have a status', [{ path: 'status', message: 'Not applicable' }]);
        edge.status = patch.status;
      }
      if (patch.startDate !== undefined) edge.set('startDate', patch.startDate);
      if (patch.endDate !== undefined) edge.set('endDate', patch.endDate);
      if (patch.verification) edge.verification = patch.verification;
      if (patch.notes !== undefined) edge.notes = patch.notes;
      if (patch.sources) edge.set('sources', patch.sources);
      edge.updatedBy = actor.userId;
      await edge.save({ session });
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'relationship.update', targetType: 'relationship', targetId: edge._id, before, after: edge.toObject(), contributionId: actor.contributionId ?? null, requestId: actor.requestId, ip: actor.ip },
        session,
      );
      return edge;
    });
    await this.graph.request(access.familyId);
    return updated;
  }

  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    const existing = await this.load(access, id);
    await this.assertManage(access, [existing.personA, existing.personB]);
    await mongoose.connection.transaction(async (session) => {
      await this.lockGraph(access.familyId, session);
      const edge = await this.load(access, id, session);
      edge.deletedAt = new Date();
      edge.deletedBy = actor.userId;
      await edge.save({ session });
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'relationship.delete', targetType: 'relationship', targetId: edge._id, before: edge.toObject(), contributionId: actor.contributionId ?? null, requestId: actor.requestId, ip: actor.ip },
        session,
      );
    });
    await this.graph.request(access.familyId);
  }

  /** Soft-deletes every live edge touching a person (used when the person is deleted). */
  async removeAllFor(access: FamilyAccess, actor: Actor, personId: Types.ObjectId, session: ClientSession, at = new Date()): Promise<number> {
    await this.lockGraph(access.familyId, session);
    const result = await RelationshipModel.updateMany(
      { familyId: access.familyId, $or: [{ personA: personId }, { personB: personId }], ...live },
      { $set: { deletedAt: at, deletedBy: actor.userId } },
      { session },
    );
    return result.modifiedCount;
  }

  /** Re-checks every integrity rule before bringing a removed link back. Returns false if it no longer fits. */
  private async restoreEdge(access: FamilyAccess, edge: RelationshipDoc, session: ClientSession): Promise<boolean> {
    const familyId = access.familyId;
    try {
      await this.assertPeople(familyId, [edge.personA, edge.personB], session);
      if (await RelationshipModel.exists({ familyId, type: edge.type, personA: edge.personA, personB: edge.personB, ...live }).session(session)) return false;
      if (edge.type === 'parent_child') await this.checkParentChild(familyId, edge.personA, edge.personB, edge.subtype, session, edge._id);
      else await this.checkPartnership(familyId, edge.personA, edge.personB, session);
    } catch (err) {
      if (err instanceof AppError) return false;
      throw err;
    }
    edge.deletedAt = null;
    edge.deletedBy = null;
    await edge.save({ session });
    return true;
  }

  /** Restores the links removed together with a person (same removal timestamp). */
  async restoreRemovedWith(access: FamilyAccess, _actor: Actor, personId: Types.ObjectId, removedAt: Date, session: ClientSession) {
    await this.lockGraph(access.familyId, session);
    const edges = await RelationshipModel.find({ familyId: access.familyId, $or: [{ personA: personId }, { personB: personId }], deletedAt: removedAt }).session(session);
    let restored = 0;
    for (const e of edges) if (await this.restoreEdge(access, e, session)) restored++;
    return { restored: personId.toString(), relationshipsRestored: restored, relationshipsSkipped: edges.length - restored };
  }

  /** Restores a single removed link, if it still satisfies the integrity rules. */
  async restore(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    access.assert('record.restore');
    await mongoose.connection.transaction(async (session) => {
      await this.lockGraph(access.familyId, session);
      const edge = await RelationshipModel.findOne({ _id: id, familyId: access.familyId, deletedAt: { $ne: null } }).session(session);
      if (!edge) throw AppError.notFound('Removed relationship');
      if (!(await this.restoreEdge(access, edge, session))) {
        throw new AppError('CONFLICT', 'This link can no longer be restored: it would duplicate an existing link, create a cycle, or one of the people was removed.');
      }
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'relationship.restore', targetType: 'relationship', targetId: edge._id, after: edge.toObject(), contributionId: actor.contributionId ?? null, requestId: actor.requestId, ip: actor.ip },
        session,
      );
    });
    await this.graph.request(access.familyId);
  }
}

export function sortedPair(a: Types.ObjectId, b: Types.ObjectId): { personA: Types.ObjectId; personB: Types.ObjectId } {
  return a.toString() < b.toString() ? { personA: a, personB: b } : { personA: b, personB: a };
}
