import type { FuzzyDate } from './dates.js';
import type { SourceReference } from './members.js';
export const RELATIONSHIP_TYPES = ['parent_child', 'partnership'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const PARENT_CHILD_SUBTYPES = ['biological', 'adoptive', 'step', 'foster', 'guardian', 'unknown'] as const;
export type ParentChildSubtype = (typeof PARENT_CHILD_SUBTYPES)[number];

export const PARTNERSHIP_SUBTYPES = [
  'marriage',
  'customary_marriage',
  'civil_union',
  'partnership',
  'engagement',
  'unknown',
] as const;
export type PartnershipSubtype = (typeof PARTNERSHIP_SUBTYPES)[number];

export const PARTNERSHIP_STATUSES = ['current', 'divorced', 'separated', 'widowed', 'annulled', 'unknown'] as const;
export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number];

export const VERIFICATION_STATES = ['verified', 'unverified', 'disputed'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** Parent-child subtypes that can ever count as descent for generation numbering. */
export const DESCENT_SUBTYPES: readonly ParentChildSubtype[] = ['biological', 'adoptive'];

export const PARENT_CHILD_SUBTYPE_LABELS: Record<ParentChildSubtype, string> = {
  biological: 'Biological',
  adoptive: 'Adoptive',
  step: 'Step',
  foster: 'Foster',
  guardian: 'Guardian',
  unknown: 'Unknown',
};

export const PARTNERSHIP_SUBTYPE_LABELS: Record<PartnershipSubtype, string> = {
  marriage: 'Marriage',
  customary_marriage: 'Customary marriage',
  civil_union: 'Civil union',
  partnership: 'Partnership',
  engagement: 'Engagement',
  unknown: 'Unknown',
};

export const PARTNERSHIP_STATUS_LABELS: Record<PartnershipStatus, string> = {
  current: 'Current',
  divorced: 'Divorced',
  separated: 'Separated',
  widowed: 'Widowed',
  annulled: 'Annulled',
  unknown: 'Unknown',
};

/**
 * parent_child: personA is the parent, personB the child.
 * partnership: order does not matter (the server stores the pair sorted).
 */
export interface CreateRelationshipRequest {
  type: RelationshipType;
  personA: string;
  personB: string;
  subtype: ParentChildSubtype | PartnershipSubtype;
  status?: PartnershipStatus;
  startDate?: FuzzyDate | null;
  endDate?: FuzzyDate | null;
  verification?: VerificationState;
  notes?: string;
  sources?: SourceReference[];
}

export interface UpdateRelationshipRequest {
  version: number;
  subtype?: ParentChildSubtype | PartnershipSubtype;
  status?: PartnershipStatus;
  startDate?: FuzzyDate | null;
  endDate?: FuzzyDate | null;
  verification?: VerificationState;
  notes?: string;
  sources?: SourceReference[];
}

export interface RelationshipView {
  id: string;
  familyId: string;
  type: RelationshipType;
  personA: string;
  personB: string;
  subtype: ParentChildSubtype | PartnershipSubtype;
  status: PartnershipStatus | null;
  startDate: FuzzyDate | null;
  endDate: FuzzyDate | null;
  verification: VerificationState;
  notes: string;
  sources: SourceReference[];
  version: number;
  createdAt: string;
}
