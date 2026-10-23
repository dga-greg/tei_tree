import { Types } from 'mongoose';
import { FamilyModel } from '../families/family.model.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { FamilyMemberModel } from './member.model.js';

/**
 * Family IDs.
 *
 * - The family head is G1. Their children are G1.1, G1.2, … in the order they are added (birth order when several are
 *   added at once); a child of G1.2 is G1.2.1, and so on.
 * - A child takes the ID of whichever parent descends from the head; when both do, the father's.
 * - A husband or wife who married in takes their partner's ID with -W (wife), -H (husband) or -S, numbered: G1.2-W1,
 *   G1.2-W2.
 * - An ID never changes once given and is never reused, even after the person is removed, so it can be written down
 *   and shared. A child found later is numbered after the existing ones.
 * - When an earlier family head is found and made head, existing IDs stay: the new head is G0 (then G-1, …), and
 *   their other children are G0.1, G0.2, ….
 * - People not yet connected to anyone with an ID have none.
 */

/** True for the head's line (G1, G1.2.3, G0, G-1.4); false for spouses (G1.2-W1). */
export function isLineCode(code: string): boolean {
  return /^G-?\d+(\.\d+)*$/.test(code);
}

/** The head number of a head's code (G1 → 1, G0 → 0, G-1 → -1), or null. */
function headNumber(code: string): number | null {
  const m = /^G(-?\d+)$/.exec(code);
  return m ? Number(m[1]) : null;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The next free number after `prefix` among codes already given (removed people included). */
function nextNumber(codes: Iterable<string>, pattern: RegExp): number {
  let max = 0;
  for (const c of codes) {
    const m = pattern.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

interface Person {
  id: string;
  code: string | null;
  gender: string | null;
  live: boolean;
  birth: number | null;
  createdAt: number;
}

/** Gives family IDs to everyone who is connected and has none yet. Existing IDs are never touched. */
export async function assignFamilyCodes(familyId: Types.ObjectId): Promise<number> {
  const family = await FamilyModel.findById(familyId, { foundingMemberId: 1 }).lean();
  if (!family) return 0;
  const docs = await FamilyMemberModel.find({ familyId }, { familyCode: 1, gender: 1, deletedAt: 1, 'birthDate.sortKey': 1, createdAt: 1 }).lean();
  const people = new Map<string, Person>(
    docs.map((d) => [
      d._id.toString(),
      { id: d._id.toString(), code: d.familyCode ?? null, gender: d.gender ?? null, live: !d.deletedAt, birth: d.birthDate?.sortKey ?? null, createdAt: d.createdAt.getTime() },
    ]),
  );
  const codes = new Set(docs.map((d) => d.familyCode).filter((c): c is string => !!c));
  const links = await RelationshipModel.find({ familyId, deletedAt: null }, { type: 1, personA: 1, personB: 1 }).lean();
  const parentsOf = new Map<string, string[]>();
  const partnersOf = new Map<string, string[]>();
  for (const l of links) {
    const a = l.personA.toString();
    const b = l.personB.toString();
    if (l.type === 'parent_child') parentsOf.set(b, [...(parentsOf.get(b) ?? []), a]);
    else {
      partnersOf.set(a, [...(partnersOf.get(a) ?? []), b]);
      partnersOf.set(b, [...(partnersOf.get(b) ?? []), a]);
    }
  }

  const given = new Map<string, string>();
  const give = (p: Person, code: string) => {
    p.code = code;
    codes.add(code);
    given.set(p.id, code);
  };

  // The head: G1 for a new family; an earlier head found later goes above the highest one so far.
  const head = family.foundingMemberId ? people.get(family.foundingMemberId.toString()) : undefined;
  if (head?.live && !head.code) {
    const heads = [...codes].map(headNumber).filter((n): n is number => n !== null);
    give(head, heads.length ? `G${Math.min(...heads) - 1}` : 'G1');
  }

  const order = (a: Person, b: Person) => (a.birth ?? Number.MAX_SAFE_INTEGER) - (b.birth ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  const waiting = () => [...people.values()].filter((p) => p.live && !p.code).sort(order);

  for (let changed = true; changed; ) {
    changed = false;
    // Children of the head's line.
    for (const child of waiting()) {
      const lineParents = (parentsOf.get(child.id) ?? []).map((id) => people.get(id)).filter((p): p is Person => !!p?.live && !!p.code && isLineCode(p.code));
      if (!lineParents.length) continue;
      const parent = lineParents.find((p) => p.gender === 'male') ?? lineParents[0]!;
      give(child, `${parent.code}.${nextNumber(codes, new RegExp(`^${escape(parent.code!)}\\.(\\d+)$`))}`);
      changed = true;
    }
    // Husbands and wives who married into the head's line.
    for (const spouse of waiting()) {
      const partner = (partnersOf.get(spouse.id) ?? []).map((id) => people.get(id)).find((p) => !!p?.live && !!p.code && isLineCode(p.code));
      if (!partner) continue;
      const letter = spouse.gender === 'female' ? 'W' : spouse.gender === 'male' ? 'H' : 'S';
      give(spouse, `${partner.code}-${letter}${nextNumber(codes, new RegExp(`^${escape(partner.code!)}-${letter}(\\d+)$`))}`);
      changed = true;
    }
  }

  // Only people still without an ID are written, so a concurrent run cannot overwrite one already given.
  for (const [id, code] of given) {
    await FamilyMemberModel.updateOne({ _id: id, familyCode: null }, { $set: { familyCode: code } });
  }
  return given.size;
}

/**
 * Gives IDs to people in families that existed before family IDs (or were changed while giving IDs failed).
 * Run once at start-up. Returns how many families had people given an ID.
 */
export async function backfillFamilyCodes(log: (familyId: string, err: unknown) => void): Promise<number> {
  const familyIds = await FamilyMemberModel.distinct('familyId', { familyCode: null, deletedAt: null });
  let done = 0;
  for (const familyId of familyIds as Types.ObjectId[]) {
    const family = await FamilyModel.exists({ _id: familyId, foundingMemberId: { $ne: null } });
    if (!family) continue;
    try {
      if ((await assignFamilyCodes(familyId)) > 0) done++;
    } catch (err) {
      log(familyId.toString(), err);
    }
  }
  return done;
}
