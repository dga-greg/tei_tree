export const PLATFORM_ROLES = ['super_admin', 'user'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const FAMILY_ROLES = ['family_admin', 'family_moderator', 'family_member'] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

/** A viewer with no active membership in the family (anonymous or signed in). */
export const GUEST = 'guest' as const;
export type FamilyViewerRole = FamilyRole | typeof GUEST;

export const FAMILY_ROLE_LABELS: Record<FamilyViewerRole, string> = {
  family_admin: 'Family Administrator',
  family_moderator: 'Family Moderator',
  family_member: 'Family Member',
  guest: 'Guest',
};

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: 'Super Administrator',
  user: 'User',
};
