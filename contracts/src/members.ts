import type { FuzzyDate } from './dates.js';
import type {
  ParentChildSubtype,
  PartnershipStatus,
  PartnershipSubtype,
  VerificationState,
} from './relationships.js';

export const GENDERS = ['female', 'male', 'non_binary', 'other', 'undisclosed'] as const;
export type Gender = (typeof GENDERS)[number];

export const VITAL_STATUSES = ['living', 'deceased', 'unknown'] as const;
export type VitalStatus = (typeof VITAL_STATUSES)[number];

export const MEMBER_PRIVACY_LEVELS = ['family', 'public', 'restricted'] as const;
export type MemberPrivacyLevel = (typeof MEMBER_PRIVACY_LEVELS)[number];

export const MEMBER_PRIVACY_LABELS: Record<MemberPrivacyLevel, string> = {
  family: 'Family members',
  public: 'Public (deceased only)',
  restricted: 'Administrators and moderators',
};

export const GENERATION_STATUSES = [
  'founder',
  'computed',
  'conflict',
  'married_in',
  'unconnected',
  'unverified_path',
  'pending',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export interface GenerationInfo {
  /** Null unless status is `founder` or `computed` (or an override resolved a conflict). */
  number: number | null;
  status: GenerationStatus;
  /** Candidate numbers when status is `conflict`, or provisional number for `unverified_path`. */
  candidates: number[];
  overridden: boolean;
}

/** An extra detail the family records on a person, e.g. "Occupation: Teacher". */
export interface MemberAttribute {
  name: string;
  value: string;
}

export const ATTRIBUTE_NAME_MAX_LENGTH = 60;
export const ATTRIBUTE_VALUE_MAX_LENGTH = 500;
export const MAX_ATTRIBUTES = 50;

/** Compact person representation used by lists, relatives, tree nodes and search results. */
export interface PersonCard {
  id: string;
  /**
   * The person's family ID: G1 for the family head, G1.2 for the head's second child, G1.2.1 for that child's first
   * child; a husband or wife who married in takes their partner's ID with -W1, -H1 (or -S1). Never changes once given;
   * null until the person is connected to the family.
   */
  familyCode: string | null;
  /** The name people call them by. */
  preferredName: string;
  displayName: string;
  firstName: string;
  surname: string;
  photoUrl: string | null;
  birthDate: FuzzyDate | null;
  deathDate: FuzzyDate | null;
  /** Null when the viewer is not authorised to know it. */
  vitalStatus: VitalStatus | null;
  gender: Gender | null;
  hometown: string | null;
  /** Where the person lives now. */
  residence: string | null;
  generation: GenerationInfo;
  isFounder: boolean;
}

export interface TimelineEntry {
  title: string;
  organisation?: string;
  from?: FuzzyDate | null;
  to?: FuzzyDate | null;
  description?: string;
}

export interface SourceReference {
  title: string;
  citation?: string;
  url?: string;
}

export interface MemberContact {
  email?: string;
  phone?: string;
  address?: string;
}

/** Editable person fields (create and update). */
export interface MemberInput {
  firstName: string;
  /** A published photo from the family archive. */
  profilePhotoMediaId?: string | null;
  middleNames?: string;
  surname?: string;
  maidenName?: string;
  previousNames?: string[];
  preferredName?: string;
  title?: string;
  gender?: Gender | null;
  vitalStatus?: VitalStatus;
  birthDate?: FuzzyDate | null;
  birthPlace?: string;
  deathDate?: FuzzyDate | null;
  deathPlace?: string;
  nationality?: string;
  hometown?: string;
  /** Where the person lives now ("place of stay"). */
  residence?: string;
  /** Extra details, in the order shown. */
  attributes?: MemberAttribute[];
  /** Line through the mother (e.g. abusua), when recorded on this person; otherwise inherited. */
  maternalLine?: string;
  /** Line through the father (e.g. ntoro or clan). */
  paternalLine?: string;
  totem?: string;
  biography?: string;
  education?: TimelineEntry[];
  occupations?: TimelineEntry[];
  achievements?: string[];
  sources?: SourceReference[];
  privacy?: { level?: MemberPrivacyLevel; hideDates?: boolean };
  contact?: MemberContact | null;
}

export interface ParentLinkInput {
  memberId: string;
  subtype: ParentChildSubtype;
  verification?: VerificationState;
}

export interface PartnerLinkInput {
  memberId: string;
  subtype: PartnershipSubtype;
  status?: PartnershipStatus;
  verification?: VerificationState;
}

export interface CreateMemberRequest {
  person: MemberInput;
  /** Relationships created atomically with the person. */
  links?: {
    parents?: ParentLinkInput[];
    children?: ParentLinkInput[];
    partners?: PartnerLinkInput[];
  };
}

export type UpdateMemberRequest = Partial<MemberInput> & { version: number };

export interface RelativeLink {
  relationshipId: string;
  person: PersonCard;
  subtype: ParentChildSubtype | PartnershipSubtype;
  status: PartnershipStatus | null;
  verification: VerificationState;
  startDate: FuzzyDate | null;
  endDate: FuzzyDate | null;
}

export const SIBLING_KINDS = ['full', 'half', 'step_or_adoptive'] as const;
export type SiblingKind = (typeof SIBLING_KINDS)[number];

export interface SiblingLink {
  person: PersonCard;
  kind: SiblingKind;
  /** Ids of the parents the two people share. */
  sharedParentIds: string[];
}

/** Full profile, redacted server-side according to the viewer's role and the person's privacy. */
export interface MemberView extends PersonCard {
  familyId: string;
  profilePhotoMediaId: string | null;
  fullName: string;
  middleNames: string;
  maidenName: string;
  previousNames: string[];
  title: string;
  attributes: MemberAttribute[];
  birthPlace: string | null;
  deathPlace: string | null;
  nationality: string | null;
  biography: string | null;
  education: TimelineEntry[];
  occupations: TimelineEntry[];
  achievements: string[];
  sources: SourceReference[];
  /** Values recorded on this person (for editing). */
  maternalLine: string;
  paternalLine: string;
  totem: string;
  /** Lines as they apply to this person, own or inherited (null when the family does not use that line). */
  lineage: import('./lineage.js').MemberLineage;
  privacy: { level: MemberPrivacyLevel; hideDates: boolean } | null;
  contact: MemberContact | null;
  /** True when some fields were withheld from this viewer. */
  redacted: boolean;
  relatives: {
    parents: RelativeLink[];
    children: RelativeLink[];
    partners: RelativeLink[];
    siblings: SiblingLink[];
  };
  viewerCan: {
    update: boolean;
    delete: boolean;
    manageRelationships: boolean;
    viewPrivate: boolean;
    /** May suggest changes for review (ordinary members). */
    propose: boolean;
    /** May directly edit their own claimed profile's personal details. */
    editOwn: boolean;
    /** May ask to be linked to this profile. */
    claim: boolean;
    /** May see history and restore earlier versions. */
    viewHistory: boolean;
  };
  version: number | null;
  createdAt: string;
  updatedAt: string;
}

export const MEMBER_SORTS = ['name', 'birth', 'generation', 'recent'] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];

export interface ListMembersQuery {
  q?: string;
  generation?: number;
  generationStatus?: GenerationStatus;
  branchId?: string;
  vitalStatus?: VitalStatus;
  hometown?: string;
  birthYear?: number;
  sort?: MemberSort;
  page?: number;
  pageSize?: number;
}
