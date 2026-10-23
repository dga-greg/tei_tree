import type { FamilyViewerRole, PlatformRole } from './roles.js';

/**
 * Permission matrix — the single source of truth for authorisation rules.
 * The backend enforces it; the frontend only uses it to hide controls.
 * See docs/03-PERMISSIONS.md.
 */

export const FAMILY_PERMISSIONS = [
  'family.view',
  'family.update',
  'family.export',
  'family.delete',
  'family.manage_privacy',
  'family.set_founder',
  'member.view',
  'member.view_private',
  'member.create',
  'member.update',
  'member.delete',
  'relationship.manage',
  'contribution.submit',
  'contribution.review',
  'invitation.manage',
  'invitation.request',
  'membership.manage',
  'branch.manage',
  'media.view',
  'media.upload',
  'media.delete',
  'story.create',
  'story.manage',
  'event.manage',
  'audit.view',
  'record.restore',
  'generation.recalculate',
  'family.import',
  'member.merge',
  'finance.view',
  'finance.manage',
] as const;
export type FamilyPermission = (typeof FAMILY_PERMISSIONS)[number];

export const PLATFORM_PERMISSIONS = [
  'platform.settings',
  'platform.users.view',
  'platform.users.manage',
  'platform.families.view',
  'platform.families.manage',
  'platform.stats',
  'platform.reports.manage',
  'family.create',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

/**
 * How a role holds a permission:
 * - `full`        unrestricted within the family
 * - `branch`      only for records in the moderator's assigned branches (all if none assigned)
 * - `propose`     only by submitting a contribution for review
 * - `own`         only for records the viewer owns (own uploads, own claimed profile)
 * - `public`      only for data the family has made public
 */
export type Grant = 'full' | 'branch' | 'propose' | 'own' | 'public';

type Matrix = Record<FamilyPermission, Partial<Record<FamilyViewerRole, Grant>>>;

export const FAMILY_PERMISSION_MATRIX: Matrix = {
  'family.view': { family_admin: 'full', family_moderator: 'full', family_member: 'full', guest: 'public' },
  'family.update': { family_admin: 'full' },
  'family.export': { family_admin: 'full' },
  'family.delete': { family_admin: 'full' },
  'family.manage_privacy': { family_admin: 'full' },
  'family.set_founder': { family_admin: 'full' },
  'member.view': { family_admin: 'full', family_moderator: 'full', family_member: 'full', guest: 'public' },
  'member.view_private': { family_admin: 'full', family_moderator: 'branch', family_member: 'own' },
  'member.create': { family_admin: 'full', family_moderator: 'branch', family_member: 'propose' },
  'member.update': { family_admin: 'full', family_moderator: 'branch', family_member: 'propose' },
  'member.delete': { family_admin: 'full', family_member: 'propose', family_moderator: 'propose' },
  'relationship.manage': { family_admin: 'full', family_moderator: 'branch', family_member: 'propose' },
  'contribution.submit': { family_admin: 'full', family_moderator: 'full', family_member: 'full' },
  'contribution.review': { family_admin: 'full', family_moderator: 'branch' },
  'invitation.manage': { family_admin: 'full' },
  'invitation.request': { guest: 'full' },
  'membership.manage': { family_admin: 'full' },
  'branch.manage': { family_admin: 'full' },
  'media.view': { family_admin: 'full', family_moderator: 'full', family_member: 'full', guest: 'public' },
  'media.upload': { family_admin: 'full', family_moderator: 'full', family_member: 'propose' },
  'media.delete': { family_admin: 'full', family_moderator: 'full', family_member: 'own' },
  'story.create': { family_admin: 'full', family_moderator: 'full', family_member: 'propose' },
  'story.manage': { family_admin: 'full', family_moderator: 'full', family_member: 'own' },
  'event.manage': { family_admin: 'full', family_moderator: 'full' },
  'audit.view': { family_admin: 'full' },
  'record.restore': { family_admin: 'full' },
  'generation.recalculate': { family_admin: 'full' },
  'family.import': { family_admin: 'full' },
  'member.merge': { family_admin: 'full' },
  // Treasurers (a flag on a membership, any role) also hold finance.manage: see canFamily.
  'finance.view': { family_admin: 'full', family_moderator: 'full', family_member: 'full' },
  'finance.manage': { family_admin: 'full' },
};

export const PLATFORM_PERMISSION_MATRIX: Record<PlatformPermission, readonly PlatformRole[]> = {
  'platform.settings': ['super_admin'],
  'platform.users.view': ['super_admin'],
  'platform.users.manage': ['super_admin'],
  'platform.families.view': ['super_admin'],
  'platform.families.manage': ['super_admin'],
  'platform.stats': ['super_admin'],
  'platform.reports.manage': ['super_admin'],
  'family.create': ['super_admin', 'user'],
};

/** The grant a role holds for a permission, or `null` when denied. */
export function familyGrant(role: FamilyViewerRole, permission: FamilyPermission): Grant | null {
  return FAMILY_PERMISSION_MATRIX[permission][role] ?? null;
}

export interface FamilyPermissionContext {
  role: FamilyViewerRole;
  /** Branches a moderator is restricted to. Empty means all branches. */
  moderatedBranchIds?: readonly string[];
  /** The family's treasurer: manages its funds whatever their role. */
  treasurer?: boolean;
}

export interface FamilyPermissionTarget {
  /** Branches the target record belongs to (derived by the server). */
  branchIds?: readonly string[];
  /** True when the target belongs to the viewer (own upload / own claimed profile). */
  ownedByViewer?: boolean;
  /** True when the target data is public under the family's privacy settings. */
  isPublic?: boolean;
}

/**
 * Whether the viewer may perform `permission` *directly* on the target.
 * `propose` grants return false here — callers route those through contributions
 * (see `canPropose`).
 */
export function canFamily(
  ctx: FamilyPermissionContext,
  permission: FamilyPermission,
  target: FamilyPermissionTarget = {},
): boolean {
  if (permission === 'finance.manage' && ctx.treasurer && ctx.role !== 'guest') return true;
  const grant = familyGrant(ctx.role, permission);
  switch (grant) {
    case 'full':
      return true;
    case 'branch': {
      const scope = ctx.moderatedBranchIds ?? [];
      if (scope.length === 0) return true;
      const targetBranches = target.branchIds ?? [];
      return targetBranches.some((id) => scope.includes(id));
    }
    case 'own':
      return target.ownedByViewer === true;
    case 'public':
      return target.isPublic === true;
    case 'propose':
    case null:
      return false;
  }
}

/** Whether the viewer may submit a contribution proposing this action. */
export function canPropose(ctx: FamilyPermissionContext, permission: FamilyPermission): boolean {
  const grant = familyGrant(ctx.role, permission);
  return grant !== null && grant !== 'public' && familyGrant(ctx.role, 'contribution.submit') !== null;
}

export function canPlatform(role: PlatformRole, permission: PlatformPermission): boolean {
  return PLATFORM_PERMISSION_MATRIX[permission].includes(role);
}
