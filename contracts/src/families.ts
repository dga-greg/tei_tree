import type { FamilyRole, FamilyViewerRole } from './roles.js';

export const FAMILY_VISIBILITIES = ['private', 'unlisted', 'public'] as const;
export type FamilyVisibility = (typeof FAMILY_VISIBILITIES)[number];

export const FAMILY_STATUSES = ['active', 'suspended', 'archived', 'pending_deletion'] as const;
export type FamilyStatus = (typeof FAMILY_STATUSES)[number];

export interface FamilyOrigin {
  hometown: string;
  region: string;
  country: string;
}

export interface FamilyPrivacySettings {
  visibility: FamilyVisibility;
  showLivingToMembers: boolean;
  allowMemberUploads: boolean;
  requireApprovalForMemberEdits: boolean;
}

export interface FamilyGenerationPolicy {
  /** Whether adoptive parent-child links count as descent for generation numbering. */
  countAdoptive: boolean;
}

export interface FamilyStats {
  memberCount: number;
  generationCount: number;
  branchCount: number;
  livingCount: number;
  deceasedCount: number;
  recalculatedAt: string | null;
}

/** A family as seen by someone allowed to view it. Guests receive the `public` subset only. */
export interface FamilyView {
  id: string;
  name: string;
  slug: string;
  description: string;
  history: string;
  emblemUrl: string | null;
  foundingMemberId: string | null;
  origin: FamilyOrigin;
  privacy: FamilyPrivacySettings | null;
  generationPolicy: FamilyGenerationPolicy | null;
  /** Lineage settings (members only). */
  lineage: import('./lineage.js').FamilyLineageSettings | null;
  /** How announcements begin and end (members only). */
  messageTemplate: import('./announcements.js').FamilyMessageTemplate | null;
  status: FamilyStatus;
  stats: FamilyStats;
  createdAt: string;
  viewerRole: FamilyViewerRole;
  /** Optimistic-concurrency token for PATCH. Present for members only. */
  version: number | null;
}

/** An entry in "my families". */
export interface FamilySummary {
  id: string;
  name: string;
  slug: string;
  origin: FamilyOrigin;
  role: FamilyRole;
  /** The viewer is a treasurer of this family (manages its funds). */
  treasurer: boolean;
  memberCount: number;
  generationCount: number;
  joinedAt: string;
}

export const FAMILY_NAME_MAX_LENGTH = 120;

export interface CreateFamilyRequest {
  name: string;
  description?: string;
  history?: string;
  origin?: Partial<FamilyOrigin>;
  privacy?: Partial<FamilyPrivacySettings>;
  generationPolicy?: Partial<FamilyGenerationPolicy>;
  lineage?: import('./lineage.js').FamilyLineageSettings;
  /** Optional founding ancestor, created together with the family as Generation 1. */
  founder?: import('./members.js').MemberInput;
}

export interface UpdateFamilyRequest {
  /** The `version` last read; a stale version is rejected with VERSION_CONFLICT. */
  version: number;
  name?: string;
  description?: string;
  history?: string;
  origin?: Partial<FamilyOrigin>;
  privacy?: Partial<FamilyPrivacySettings>;
  generationPolicy?: Partial<FamilyGenerationPolicy>;
  lineage?: import('./lineage.js').FamilyLineageSettings;
  messageTemplate?: import('./announcements.js').FamilyMessageTemplate;
}

export interface SetFounderRequest {
  memberId: string;
  reason?: string;
}

/** Registration metadata for platform administrators — never genealogy content. */
export interface AdminFamilyView {
  id: string;
  name: string;
  slug: string;
  status: FamilyStatus;
  visibility: FamilyVisibility;
  createdAt: string;
  createdBy: { id: string; email: string; displayName: string } | null;
  memberCount: number;
  accountCount: number;
}

export interface AdminUpdateFamilyRequest {
  status: FamilyStatus;
}
