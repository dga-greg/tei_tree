import type { ClientSession, Types } from 'mongoose';
import { RelationshipModel } from '../relationships/relationship.model.js';

/**
 * Descent as used for branches: the same rule as generation numbering — verified biological links,
 * plus adoptive links when the family counts them. Branch membership is therefore derived from the
 * relationships and never stored on people.
 */
export function descentFilter(familyId: Types.ObjectId, countAdoptive: boolean) {
  return {
    familyId,
    type: 'parent_child',
    deletedAt: null,
    verification: 'verified',
    subtype: { $in: countAdoptive ? ['biological', 'adoptive'] : ['biological'] },
  };
}

/** Everyone descended from `roots` (excluding the roots). Breadth-first, one query per generation. */
export async function descendantsOf(familyId: Types.ObjectId, roots: Types.ObjectId[], countAdoptive: boolean, session?: ClientSession): Promise<Set<string>> {
  const seen = new Set(roots.map(String));
  const found = new Set<string>();
  let frontier = roots;
  while (frontier.length) {
    const edges = await RelationshipModel.find({ ...descentFilter(familyId, countAdoptive), personA: { $in: frontier } }, { personB: 1 })
      .session(session ?? null)
      .lean();
    frontier = [];
    for (const e of edges) {
      const id = e.personB.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      found.add(id);
      frontier.push(e.personB);
    }
  }
  return found;
}

/** The person and all their ancestors by descent. */
export async function selfAndAncestors(familyId: Types.ObjectId, person: Types.ObjectId, countAdoptive: boolean, session?: ClientSession): Promise<Set<string>> {
  const seen = new Set([person.toString()]);
  let frontier = [person];
  while (frontier.length) {
    const edges = await RelationshipModel.find({ ...descentFilter(familyId, countAdoptive), personB: { $in: frontier } }, { personA: 1 })
      .session(session ?? null)
      .lean();
    frontier = [];
    for (const e of edges) {
      const id = e.personA.toString();
      if (seen.has(id)) continue;
      seen.add(id);
      frontier.push(e.personA);
    }
  }
  return seen;
}
