import { Types } from 'mongoose';
import {
  LINEAGE_SIDES,
  type LineageGroup,
  type LineageOverview,
  type LineageSide,
  type LineageValue,
  type MemberLineage,
  type PersonCard,
} from '@fh/contracts';
import { z } from 'zod';
import { lineageSettingsOf } from '../families/family.mapper.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import type { MemberPolicy } from '../members/member.policy.js';
import { MemberPolicy as Policy } from '../members/member.policy.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { computeLineage, type ResolvedLineage, type ResolvedValue } from './lineage-engine.js';

export const lineageQuery = z.object({ side: z.enum(LINEAGE_SIDES).default('maternal') }).strict();

interface Cached {
  revision: string;
  lines: Map<string, ResolvedLineage>;
}

const CACHE_SIZE = 20;
/** Shared by every request: lines change only when people, links or the family's settings do. */
const cache = new Map<string, Cached>();

const MAX_PEOPLE_PER_GROUP = 500;

/** Lines of descent (maternal, paternal, totem) for a family; see lineage-engine.ts. */
export class LineageService {
  async lines(access: FamilyAccess): Promise<Map<string, ResolvedLineage>> {
    const settings = lineageSettingsOf(access.family);
    const key = access.familyId.toString();
    const revision = `${access.family.graphRevision ?? 0}:${access.family.get('peopleRevision') ?? 0}:${JSON.stringify(settings)}`;
    const hit = cache.get(key);
    if (hit?.revision === revision) {
      cache.delete(key);
      cache.set(key, hit);
      return hit.lines;
    }
    const [people, links] = await Promise.all([
      FamilyMemberModel.find({ familyId: access.familyId, deletedAt: null }, { gender: 1, maternalLine: 1, paternalLine: 1, totem: 1 }).lean(),
      RelationshipModel.find({ familyId: access.familyId, deletedAt: null, type: 'parent_child' }, { personA: 1, personB: 1, subtype: 1, verification: 1 }).lean(),
    ]);
    const lines = computeLineage(
      people.map((p) => ({ id: p._id.toString(), gender: p.gender, maternalLine: p.maternalLine, paternalLine: p.paternalLine, totem: p.totem })),
      links.map((l) => ({ parent: l.personA.toString(), child: l.personB.toString(), subtype: l.subtype, verification: l.verification })),
      settings,
    );
    cache.set(key, { revision, lines });
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return lines;
  }

  /** One person's lines, with the ancestor each inherited value comes from. */
  async forMember(access: FamilyAccess, policy: MemberPolicy, id: Types.ObjectId): Promise<MemberLineage> {
    const resolved = (await this.lines(access)).get(id.toString());
    if (!resolved) return { maternal: null, paternal: null, totem: null };
    const sources = [resolved.maternal, resolved.paternal, resolved.totem].filter((v): v is ResolvedValue => !!v && v.sourceId !== id.toString()).map((v) => new Types.ObjectId(v.sourceId));
    const docs = sources.length ? await FamilyMemberModel.find({ _id: { $in: sources }, familyId: access.familyId, deletedAt: null }) : [];
    const cards = new Map(docs.filter((d) => policy.isVisible(d)).map((d) => [d.id as string, toPersonCard(d, policy)]));
    const value = (v: ResolvedValue | null): LineageValue | null => {
      if (!v) return null;
      const own = v.sourceId === id.toString();
      return { name: v.name, source: own ? 'own' : 'inherited', from: own ? null : (cards.get(v.sourceId) ?? null), ...(v.inheritedWouldBe ? { inheritedWouldBe: v.inheritedWouldBe } : {}) };
    };
    return { maternal: value(resolved.maternal), paternal: value(resolved.paternal), totem: value(resolved.totem) };
  }

  /** Every line on one side, with its people and its known roots. */
  async overview(access: FamilyAccess, side: LineageSide): Promise<LineageOverview> {
    access.assert('member.view', { isPublic: access.isPublicFamily });
    const settings = lineageSettingsOf(access.family);
    const lines = await this.lines(access);
    const policy = new Policy(access);
    const people = await FamilyMemberModel.find({ familyId: access.familyId, deletedAt: null, ...policy.visibilityFilter() });
    const byName = new Map<string, { name: string; docs: typeof people; totems: Set<string>; roots: typeof people; differences: number }>();
    let unknown = 0;
    for (const p of people) {
      if (!policy.isVisible(p)) continue;
      const l = lines.get(p.id as string);
      const v = side === 'maternal' ? l?.maternal : l?.paternal;
      if (!v) {
        unknown++;
        continue;
      }
      const key = v.name.trim().toLowerCase();
      const group = byName.get(key) ?? { name: v.name, docs: [], totems: new Set<string>(), roots: [], differences: 0 };
      group.docs.push(p);
      if (l?.totem && settings.totemFollows === side) group.totems.add(l.totem.name);
      if (v.sourceId === (p.id as string)) {
        group.roots.push(p);
        if (v.inheritedWouldBe) group.differences++;
      }
      byName.set(key, group);
    }
    const byBirth = (a: PersonCard, b: PersonCard) =>
      (a.generation.number ?? 999) - (b.generation.number ?? 999) || (a.birthDate?.sortKey ?? Infinity) - (b.birthDate?.sortKey ?? Infinity) || a.displayName.localeCompare(b.displayName);
    const groups: LineageGroup[] = [...byName.values()].map((g) => {
      const cards = g.docs.map((d) => toPersonCard(d, policy)).sort(byBirth);
      return {
        side,
        name: g.name,
        totems: [...g.totems].sort(),
        members: g.docs.length,
        living: cards.filter((c) => c.vitalStatus === 'living').length,
        roots: g.roots.map((d) => toPersonCard(d, policy)).sort(byBirth).slice(0, 10),
        people: cards.slice(0, MAX_PEOPLE_PER_GROUP),
        differences: g.differences,
      };
    });
    groups.sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
    return { settings, side, groups, unknown };
  }
}
