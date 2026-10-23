import { Types } from 'mongoose';
import { TREE_NODE_LIMIT, type TreeEdge, type TreeNode, type TreeWindow } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import type { BranchesService } from '../branches/branches.service.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel, type FamilyMemberDoc } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { LineageService } from '../lineage/lineage.service.js';

const lineage = new LineageService();

const live = { deletedAt: null };

type EdgeDoc = {
  _id: Types.ObjectId;
  type: 'parent_child' | 'partnership';
  personA: Types.ObjectId;
  personB: Types.ObjectId;
  subtype: string;
  status?: string | null;
  verification: string;
};

/**
 * Serves bounded windows of the family graph for the tree view: a root and N generations below,
 * one node's children, or a person's ancestors. Every window includes the partners of the people in
 * it (so couples can be drawn as family units) and all edges between the people it contains.
 * Parent–child links of every kind are included; the client draws each kind differently.
 */
export class TreeService {
  constructor(private readonly branches: BranchesService) {}

  private assertView(access: FamilyAccess): void {
    access.assert('member.view', { isPublic: access.isPublicFamily });
  }

  /** Walks `depth` generations of parent→child (down) or child→parent (up) edges from `start`. */
  private async walk(access: FamilyAccess, start: Types.ObjectId[], depth: number, direction: 'down' | 'up'): Promise<{ ids: Set<string>; truncated: boolean }> {
    const ids = new Set(start.map(String));
    let frontier = start;
    let truncated = false;
    for (let level = 0; level < depth && frontier.length; level++) {
      const edges = await RelationshipModel.find(
        { familyId: access.familyId, type: 'parent_child', ...live, ...(direction === 'down' ? { personA: { $in: frontier } } : { personB: { $in: frontier } }) },
        { personA: 1, personB: 1 },
      ).lean();
      const next: Types.ObjectId[] = [];
      for (const e of edges) {
        const other = direction === 'down' ? e.personB : e.personA;
        if (ids.has(other.toString())) continue;
        if (ids.size >= TREE_NODE_LIMIT) {
          truncated = true;
          break;
        }
        ids.add(other.toString());
        next.push(other);
      }
      frontier = next;
    }
    return { ids, truncated };
  }

  /** Adds partners, loads people and edges, applies privacy and counts relatives. */
  private async build(access: FamilyAccess, rootId: Types.ObjectId | null, core: Set<string>, truncated: boolean): Promise<TreeWindow> {
    const policy = new MemberPolicy(access);
    const familyId = access.familyId;
    const coreIds = [...core].map((x) => new Types.ObjectId(x));

    const partnerships = await RelationshipModel.find({ familyId, type: 'partnership', ...live, $or: [{ personA: { $in: coreIds } }, { personB: { $in: coreIds } }] }).lean<EdgeDoc[]>();
    const all = new Set(core);
    for (const p of partnerships) {
      if (all.size >= TREE_NODE_LIMIT) {
        truncated = true;
        break;
      }
      all.add(p.personA.toString());
      all.add(p.personB.toString());
    }
    const allIds = [...all].map((x) => new Types.ObjectId(x));

    const [people, parentEdges] = await Promise.all([
      FamilyMemberModel.find({ _id: { $in: allIds }, familyId, ...live }),
      // Every parent-child edge touching the window: used both to draw and to count relatives.
      RelationshipModel.find({ familyId, type: 'parent_child', ...live, $or: [{ personA: { $in: allIds } }, { personB: { $in: allIds } }] }).lean<EdgeDoc[]>(),
    ]);

    const visible: Map<string, FamilyMemberDoc> = new Map(people.filter((p) => policy.isVisible(p)).map((p) => [p.id as string, p]));
    // Counting relatives must not reveal hidden people to guests: only count visible ones.
    let countable: (id: string) => boolean = () => true;
    if (policy.isGuest) {
      const otherIds = [...new Set(parentEdges.flatMap((e) => [e.personA.toString(), e.personB.toString()]))].filter((id) => !visible.has(id));
      const extra = otherIds.length ? await FamilyMemberModel.find({ _id: { $in: otherIds.map((x) => new Types.ObjectId(x)) }, familyId, ...live, ...policy.visibilityFilter() }, { _id: 1 }).lean() : [];
      const visibleIds = new Set([...visible.keys(), ...extra.map((p) => p._id.toString())]);
      countable = (id) => visibleIds.has(id);
    } else {
      const existing = new Set(
        (await FamilyMemberModel.find({ _id: { $in: [...new Set(parentEdges.flatMap((e) => [e.personA, e.personB]))] }, familyId, ...live }, { _id: 1 }).lean()).map((p) => p._id.toString()),
      );
      countable = (id) => existing.has(id);
    }
    if (rootId && !visible.has(rootId.toString())) throw AppError.notFound('Person');

    const childCount = new Map<string, number>();
    const parentCount = new Map<string, number>();
    for (const e of parentEdges) {
      const a = e.personA.toString();
      const b = e.personB.toString();
      if (countable(b)) childCount.set(a, (childCount.get(a) ?? 0) + 1);
      if (countable(a)) parentCount.set(b, (parentCount.get(b) ?? 0) + 1);
    }

    const toEdge = (e: EdgeDoc): TreeEdge => ({
      id: e._id.toString(),
      type: e.type,
      from: e.personA.toString(),
      to: e.personB.toString(),
      subtype: e.subtype as TreeEdge['subtype'],
      status: (e.status ?? null) as TreeEdge['status'],
      verification: e.verification as TreeEdge['verification'],
    });
    const inWindow = (e: EdgeDoc) => visible.has(e.personA.toString()) && visible.has(e.personB.toString());

    const lines = await lineage.lines(access);
    const nodes: TreeNode[] = [...visible.values()].map((p) => {
      const l = lines.get(p.id as string);
      return {
        ...toPersonCard(p, policy),
        childCount: childCount.get(p.id as string) ?? 0,
        parentCount: parentCount.get(p.id as string) ?? 0,
        lineage: { maternal: l?.maternal?.name ?? null, paternal: l?.paternal?.name ?? null },
      };
    });
    return {
      rootId: rootId?.toString() ?? null,
      nodes,
      edges: [...parentEdges.filter(inWindow), ...partnerships.filter(inWindow)].map(toEdge),
      truncated,
    };
  }

  private async requirePerson(access: FamilyAccess, id: Types.ObjectId): Promise<void> {
    if (!(await FamilyMemberModel.exists({ _id: id, familyId: access.familyId, ...live }))) throw AppError.notFound('Person');
  }

  /** The founding ancestor and `depth` generations below. */
  async root(access: FamilyAccess, depth: number): Promise<TreeWindow> {
    this.assertView(access);
    const founder = access.family.foundingMemberId;
    if (!founder) return { rootId: null, nodes: [], edges: [], truncated: false };
    return this.descendants(access, founder, depth);
  }

  async descendants(access: FamilyAccess, id: Types.ObjectId, depth: number): Promise<TreeWindow> {
    this.assertView(access);
    await this.requirePerson(access, id);
    const { ids, truncated } = await this.walk(access, [id], depth, 'down');
    return this.build(access, id, ids, truncated);
  }

  /** One level: a person's children (with partners), used when expanding a node. */
  async children(access: FamilyAccess, id: Types.ObjectId): Promise<TreeWindow> {
    return this.descendants(access, id, 1);
  }

  async ancestors(access: FamilyAccess, id: Types.ObjectId, depth: number): Promise<TreeWindow> {
    this.assertView(access);
    await this.requirePerson(access, id);
    const { ids, truncated } = await this.walk(access, [id], depth, 'up');
    return this.build(access, id, ids, truncated);
  }

  async branch(access: FamilyAccess, branchId: Types.ObjectId, depth: number): Promise<TreeWindow> {
    this.assertView(access);
    const branch = await this.branches.load(access, branchId);
    return this.descendants(access, branch.foundingMemberId, depth);
  }
}
