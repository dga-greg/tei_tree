import { Types } from 'mongoose';
import { displayName, type KinshipResult, type PersonCard } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { KinshipGraph, findKinship, type KinEdge, type KinPartnership } from './kinship-engine.js';

interface CachedGraph {
  revision: string;
  graph: KinshipGraph;
  roster: Map<string, { id: string; name: string; gender: string | null }>;
}

const CACHE_SIZE = 20;

/**
 * Answers "how are these two people related?". Each family's graph (links and names) is built once and
 * cached; it is rebuilt when `families.graphRevision` (any relationship change) or
 * `families.peopleRevision` (any change to people) moves on.
 */
export class KinshipService {
  private readonly cache = new Map<string, CachedGraph>();

  private async graphFor(access: FamilyAccess): Promise<CachedGraph> {
    const key = access.familyId.toString();
    const revision = `${access.family.graphRevision ?? 0}:${access.family.get('peopleRevision') ?? 0}`;
    const hit = this.cache.get(key);
    if (hit && hit.revision === revision) {
      this.cache.delete(key);
      this.cache.set(key, hit); // keep recently used entries
      return hit;
    }
    const [rows, people] = await Promise.all([
      RelationshipModel.find({ familyId: access.familyId, deletedAt: null }, { type: 1, personA: 1, personB: 1, subtype: 1, status: 1, verification: 1 }).lean(),
      FamilyMemberModel.find({ familyId: access.familyId, deletedAt: null }, { firstName: 1, preferredName: 1, surname: 1, gender: 1 }).lean(),
    ]);
    const edges: KinEdge[] = rows
      .filter((r) => r.type === 'parent_child')
      .map((r) => ({ parent: r.personA.toString(), child: r.personB.toString(), subtype: r.subtype, verification: r.verification }));
    const partnerships: KinPartnership[] = rows
      .filter((r) => r.type === 'partnership')
      .map((r) => ({ a: r.personA.toString(), b: r.personB.toString(), subtype: r.subtype, status: r.status ?? null, verification: r.verification }));
    const roster = new Map(people.map((p) => [p._id.toString(), { id: p._id.toString(), name: displayName(p), gender: p.gender ?? null }]));
    const entry: CachedGraph = { revision, graph: new KinshipGraph(roster, edges, partnerships), roster };
    this.cache.set(key, entry);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return entry;
  }

  /** Members only: the answer can involve living people anywhere in the family. */
  async between(access: FamilyAccess, a: Types.ObjectId, b: Types.ObjectId): Promise<KinshipResult> {
    access.assert('member.view');
    const policy = new MemberPolicy(access);
    const { graph, roster } = await this.graphFor(access);
    if (!roster.has(a.toString())) throw AppError.notFound('Person');
    if (!roster.has(b.toString())) throw AppError.notFound('Person');

    const outcome = findKinship(graph, a.toString(), b.toString());

    const ids = [...new Set([a.toString(), b.toString(), ...outcome.pathPeople, ...outcome.commonAncestors])].map((x) => new Types.ObjectId(x));
    const docs = await FamilyMemberModel.find({ _id: { $in: ids }, familyId: access.familyId, deletedAt: null });
    const cards = new Map<string, PersonCard>(docs.map((d) => [d.id as string, toPersonCard(d, policy)]));
    const card = (id: string) => cards.get(id)!;
    return {
      a: card(a.toString()),
      b: card(b.toString()),
      kind: outcome.kind,
      term: outcome.term,
      reciprocal: outcome.reciprocal,
      summary: outcome.summary,
      explanation: outcome.explanation,
      blood: outcome.blood,
      commonAncestors: outcome.commonAncestors.map(card),
      path: { people: outcome.pathPeople.map(card), steps: outcome.steps },
      confidence: outcome.confidence,
      viaAdoption: outcome.viaAdoption,
      alsoPartners: outcome.alsoPartners,
    };
  }
}
