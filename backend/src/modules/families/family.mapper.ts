import { DEFAULT_LINEAGE_SETTINGS, DEFAULT_MESSAGE_TEMPLATE, type FamilyLineageSettings, type FamilyMessageTemplate, type FamilySummary, type FamilyView } from '@fh/contracts';
import { iso } from '../../core/dates.js';
import type { FamilyAccess } from './family-access.js';
import type { FamilyDoc } from './family.model.js';
import type { FamilyMembershipDoc } from './membership.model.js';

function origin(family: FamilyDoc) {
  return {
    hometown: family.origin?.hometown ?? '',
    region: family.origin?.region ?? '',
    country: family.origin?.country ?? '',
  };
}

/** The family's lineage settings, with defaults for families created before lineage existed. */
export function lineageSettingsOf(family: FamilyDoc): FamilyLineageSettings {
  const l = family.lineage;
  const d = DEFAULT_LINEAGE_SETTINGS;
  return {
    maternal: { enabled: l?.maternal?.enabled ?? d.maternal.enabled, label: l?.maternal?.label || d.maternal.label },
    paternal: { enabled: l?.paternal?.enabled ?? d.paternal.enabled, label: l?.paternal?.label || d.paternal.label },
    totemFollows: (l?.totemFollows as FamilyLineageSettings['totemFollows']) ?? d.totemFollows,
    throughAdoption: l?.throughAdoption ?? d.throughAdoption,
  };
}

/** How the family's announcements begin and end, with the defaults for families that never set them. */
export function messageTemplateOf(family: { messageTemplate?: { opening?: string | null; signOff?: string | null } | null }): FamilyMessageTemplate {
  const m = family.messageTemplate;
  return { opening: m?.opening ?? DEFAULT_MESSAGE_TEMPLATE.opening, signOff: m?.signOff ?? DEFAULT_MESSAGE_TEMPLATE.signOff };
}

/** Members see settings; guests see only the public face of a public family. */
export function toFamilyView(access: FamilyAccess): FamilyView {
  const f = access.family;
  const isMember = access.membership != null;
  return {
    id: f.id as string,
    name: f.name,
    slug: f.slug,
    description: f.description,
    history: f.history,
    emblemUrl: null, // media URLs are signed per request once the archive exists (Phase 7)
    foundingMemberId: f.foundingMemberId?.toString() ?? null,
    origin: origin(f),
    privacy: isMember && f.privacy
      ? {
          visibility: f.privacy.visibility,
          showLivingToMembers: f.privacy.showLivingToMembers,
          allowMemberUploads: f.privacy.allowMemberUploads,
          requireApprovalForMemberEdits: f.privacy.requireApprovalForMemberEdits,
        }
      : null,
    generationPolicy: isMember ? { countAdoptive: f.generationPolicy?.countAdoptive ?? true } : null,
    lineage: isMember ? lineageSettingsOf(f) : null,
    messageTemplate: isMember ? messageTemplateOf(f) : null,
    status: f.status,
    stats: {
      memberCount: f.stats?.memberCount ?? 0,
      generationCount: f.stats?.generationCount ?? 0,
      branchCount: f.stats?.branchCount ?? 0,
      // Living/deceased counts reveal information about living people; members only.
      livingCount: isMember ? (f.stats?.livingCount ?? 0) : 0,
      deceasedCount: isMember ? (f.stats?.deceasedCount ?? 0) : 0,
      recalculatedAt: iso(f.stats?.recalculatedAt),
    },
    createdAt: f.createdAt.toISOString(),
    viewerRole: access.role,
    version: isMember ? (f.get('version') as number) : null,
  };
}

export function toFamilySummary(family: FamilyDoc, membership: FamilyMembershipDoc): FamilySummary {
  return {
    id: family.id as string,
    name: family.name,
    slug: family.slug,
    origin: origin(family),
    role: membership.role,
    treasurer: membership.treasurer === true,
    memberCount: family.stats?.memberCount ?? 0,
    generationCount: family.stats?.generationCount ?? 0,
    joinedAt: membership.joinedAt.toISOString(),
  };
}
