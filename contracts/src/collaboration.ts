import type { FamilyRole } from './roles.js';
import type { PersonCard } from './members.js';

// ---------------------------------------------------------------- invitations

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export interface CreateInvitationRequest {
  email: string;
  role: FamilyRole;
  /** A profile the invitee is probably; claiming it still needs an administrator's approval. */
  suggestedProfileId?: string | null;
  message?: string;
}

export interface InvitationView {
  id: string;
  email: string;
  role: FamilyRole;
  status: InvitationStatus;
  suggestedProfile: PersonCard | null;
  message: string;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
}

/** What someone holding an invitation link may see before accepting. */
export interface InvitationPreview {
  familyName: string;
  familyOrigin: string;
  invitedBy: string;
  role: FamilyRole;
  message: string;
  email: string;
  expiresAt: string;
  status: InvitationStatus;
  suggestedProfileName: string | null;
}

/** An invitation to the signed-in person's address (GET /invitations/mine). */
export interface PendingInvitation extends InvitationPreview {
  id: string;
}

export interface AcceptInvitationResult {
  familyId: string;
  role: FamilyRole;
  /** Created when the invitation suggested a profile to claim. */
  claimContributionId: string | null;
}

// ---------------------------------------------------------------- memberships

export interface MembershipView {
  id: string;
  user: { id: string; displayName: string; email: string };
  role: FamilyRole;
  moderatedBranchIds: string[];
  /** Manages the family's funds whatever their role. */
  treasurer: boolean;
  profile: PersonCard | null;
  joinedAt: string;
  isSelf: boolean;
}

export interface UpdateMembershipRequest {
  role?: FamilyRole;
  moderatedBranchIds?: string[];
  treasurer?: boolean;
}

// ---------------------------------------------------------------- contributions

export const CONTRIBUTION_KINDS = [
  'member.create',
  'member.update',
  'member.delete',
  'relationship.create',
  'relationship.update',
  'relationship.delete',
  'claim.profile',
  'media.attach',
  'story.create',
] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export const CONTRIBUTION_KIND_LABELS: Record<ContributionKind, string> = {
  'member.create': 'New relative',
  'member.update': 'Correction',
  'member.delete': 'Removal',
  'relationship.create': 'New link',
  'relationship.update': 'Link correction',
  'relationship.delete': 'Link removal',
  'claim.profile': 'Profile claim',
  'media.attach': 'New photo or file',
  'story.create': 'New story',
};

export const CONTRIBUTION_STATUSES = ['pending', 'needs_clarification', 'approved', 'rejected', 'withdrawn'] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export interface SubmitContributionRequest {
  kind: ContributionKind;
  /** Person or relationship the proposal is about (not for member.create / relationship.create). */
  targetId?: string;
  /** Shape depends on `kind` — the same bodies as the direct endpoints, without `version`. */
  payload: Record<string, unknown>;
  /** Why the change is right: a source, a memory, a document. */
  note?: string;
}

export interface ContributionChange {
  field: string;
  current: unknown;
  proposed: unknown;
}

export interface ContributionView {
  id: string;
  kind: ContributionKind;
  status: ContributionStatus;
  summary: string;
  target: PersonCard | null;
  /** For relationship proposals: the two people. */
  people: PersonCard[];
  changes: ContributionChange[];
  payload: Record<string, unknown>;
  /** For uploads and stories: what was added (already stored, unpublished until approved). */
  archiveItem: { type: 'media' | 'story'; id: string; title: string; kind: string; thumbUrl: string | null; excerpt: string } | null;
  /** True when the record changed after the proposal was made. */
  stale: boolean;
  proposedBy: { id: string; displayName: string };
  reviewedBy: { id: string; displayName: string } | null;
  reviewNote: string;
  discussion: { by: string; byName: string; message: string; at: string }[];
  createdAt: string;
  reviewedAt: string | null;
  viewerCan: { review: boolean; respond: boolean; withdraw: boolean };
}

export interface ReviewContributionRequest {
  note?: string;
  /** Approve even though the record changed since the proposal. */
  force?: boolean;
}

// ---------------------------------------------------------------- audit

export interface AuditEntryView {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string | null;
  actor: { id: string; displayName: string } | null;
  actorRole: string;
  contributionId: string | null;
  changes: { field: string; before: unknown; after: unknown }[];
  at: string;
  restorable: boolean;
}

export interface RestoreResult {
  restored: string;
  relationshipsRestored: number;
  relationshipsSkipped: number;
}
