import type { FuzzyDate, GenerationInfo, MemberLineage, MemberView, PersonCard, RelativeLink, SiblingLink, TimelineEntry } from '@fh/contracts';
import { displayName, fullName } from '@fh/contracts';
import type { FamilyMemberDoc } from './member.model.js';
import type { MemberPolicy } from './member.policy.js';

type DateLike = { year?: number | null; month?: number | null; day?: number | null; qualifier?: string | null; endYear?: number | null; text?: string | null; sortKey?: number | null } | null | undefined;

export function toFuzzyDate(d: DateLike): FuzzyDate | null {
  if (!d || (d.year == null && !d.text)) return null;
  const out: FuzzyDate = { qualifier: (d.qualifier ?? 'exact') as FuzzyDate['qualifier'], sortKey: d.sortKey ?? null };
  if (d.year != null) out.year = d.year;
  if (d.month != null) out.month = d.month;
  if (d.day != null) out.day = d.day;
  if (d.endYear != null) out.endYear = d.endYear;
  if (d.text) out.text = d.text;
  return out;
}

function yearOnly(d: FuzzyDate | null): FuzzyDate | null {
  if (!d) return null;
  return { year: d.year, qualifier: d.qualifier === 'exact' ? 'exact' : d.qualifier, sortKey: d.year ? d.year * 10000 : null };
}

function generationOf(m: FamilyMemberDoc): GenerationInfo {
  return {
    number: m.generation?.number ?? null,
    status: m.generation?.status ?? 'pending',
    candidates: [...(m.generation?.candidates ?? [])],
    overridden: m.generation?.override != null && m.generation?.status === 'computed',
  };
}

export function toPersonCard(m: FamilyMemberDoc, policy: MemberPolicy): PersonCard {
  const full = policy.detailLevel(m) === 'full';
  const reduce = policy.reduceDates(m);
  const birth = full ? toFuzzyDate(m.birthDate) : null;
  return {
    id: m.id as string,
    familyCode: m.familyCode ?? null,
    preferredName: m.preferredName,
    displayName: displayName(m),
    firstName: m.firstName,
    surname: m.surname,
    // Same-origin link that re-checks permission and redirects to a signed file URL.
    photoUrl: full && m.profilePhotoMediaId ? `/api/v1/families/${m.familyId.toString()}/media/${m.profilePhotoMediaId.toString()}/content?variant=thumb&ngsw-bypass=1` : null,
    birthDate: reduce ? yearOnly(birth) : birth,
    deathDate: full ? toFuzzyDate(m.deathDate) : null,
    vitalStatus: full ? m.vitalStatus : null,
    gender: full ? (m.gender ?? null) : null,
    hometown: full ? m.hometown || null : null,
    residence: full ? m.residence || null : null,
    generation: generationOf(m),
    isFounder: policy.isFounder(m._id),
  };
}

function timeline(entries: FamilyMemberDoc['education']): TimelineEntry[] {
  return entries.map((e) => ({
    title: e.title,
    ...(e.organisation ? { organisation: e.organisation } : {}),
    from: toFuzzyDate(e.from),
    to: toFuzzyDate(e.to),
    ...(e.description ? { description: e.description } : {}),
  }));
}

export interface Relatives {
  parents: RelativeLink[];
  children: RelativeLink[];
  partners: RelativeLink[];
  siblings: SiblingLink[];
}

const NO_LINEAGE: MemberLineage = { maternal: null, paternal: null, totem: null };

export function toMemberView(m: FamilyMemberDoc, policy: MemberPolicy, relatives: Relatives, claimedByAnyone = false, lineage: MemberLineage = NO_LINEAGE): MemberView {
  const card = toPersonCard(m, policy);
  const full = policy.detailLevel(m) === 'full';
  const minorHidden = policy.reduceDates(m) && policy.isMinor(m);
  const editor = policy.isEditor;
  const viewPrivate = policy.canViewPrivate(m);
  const contact = viewPrivate && m.contact ? { email: m.contact.email ?? undefined, phone: m.contact.phone ?? undefined, address: m.contact.address ?? undefined } : null;
  return {
    ...card,
    familyId: m.familyId.toString(),
    profilePhotoMediaId: full && m.profilePhotoMediaId ? m.profilePhotoMediaId.toString() : null,
    fullName: fullName(m),
    middleNames: m.middleNames,
    maidenName: m.maidenName,
    previousNames: [...m.previousNames],
    title: m.title,
    attributes: full ? (m.attributes ?? []).map((a) => ({ name: a.name, value: a.value })) : [],
    birthPlace: full && !minorHidden ? m.birthPlace || null : null,
    deathPlace: full ? m.deathPlace || null : null,
    nationality: full ? m.nationality || null : null,
    biography: full ? m.biography || null : null,
    education: full ? timeline(m.education) : [],
    occupations: full ? timeline(m.occupations) : [],
    achievements: full ? [...m.achievements] : [],
    sources: full ? m.sources.map((s) => ({ title: s.title, ...(s.citation ? { citation: s.citation } : {}), ...(s.url ? { url: s.url } : {}) })) : [],
    maternalLine: m.maternalLine ?? '',
    paternalLine: m.paternalLine ?? '',
    totem: m.totem ?? '',
    lineage,
    privacy: editor || policy.isOwn(m) ? { level: m.privacy?.level ?? 'family', hideDates: m.privacy?.hideDates ?? false } : null,
    contact,
    redacted: !full || policy.reduceDates(m),
    relatives,
    viewerCan: {
      update: editor,
      delete: policy.access.can('member.delete'),
      manageRelationships: policy.isEditor,
      viewPrivate,
      propose: !editor && policy.access.canPropose('member.update'),
      editOwn: !editor && policy.isOwn(m),
      claim: m.vitalStatus !== 'deceased' && policy.access.membership != null && policy.access.ownProfileId == null && !claimedByAnyone && policy.access.can('contribution.submit'),
      viewHistory: policy.access.can('audit.view'),
    },
    version: editor || policy.isOwn(m) ? (m.get('version') as number) : null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}
