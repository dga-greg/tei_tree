import type { RelationshipView } from '@fh/contracts';
import { toFuzzyDate } from '../members/member.mapper.js';
import type { RelationshipDoc } from './relationship.model.js';

export function toRelationshipView(r: RelationshipDoc): RelationshipView {
  const plain = r.toObject();
  return {
    id: r.id as string,
    familyId: r.familyId.toString(),
    type: r.type,
    personA: r.personA.toString(),
    personB: r.personB.toString(),
    subtype: r.subtype,
    status: r.status ?? null,
    startDate: toFuzzyDate(plain.startDate),
    endDate: toFuzzyDate(plain.endDate),
    verification: r.verification,
    notes: r.notes,
    sources: plain.sources.map((s) => ({ title: s.title, ...(s.citation ? { citation: s.citation } : {}), ...(s.url ? { url: s.url } : {}) })),
    version: r.get('version') as number,
    createdAt: r.createdAt.toISOString(),
  };
}
