import {
  LucideArchive,
  LucideBookOpen,
  LucideDrum,
  LucideTrees,
  LucideWallet,
  LucideCalendarDays,
  LucideFileUp,
  LucideChartColumn,
  LucideGitFork,
  LucideHistory,
  LucideImages,
  LucideMessageSquareText,
  LucideUserCog,
  LucideLayoutDashboard,
  LucideLayers,
  LucideMapPinned,
  LucideMail,
  LucideNetwork,
  LucideSettings,
  LucideShieldAlert,
  LucideSlidersHorizontal,
  LucideShieldCheck,
  LucideUsers,
  LucideWaypoints,
  type LucideIcon,
} from '@lucide/angular';
import type { FamilyPermission } from '@fh/contracts';
import { mark } from './i18n/i18n';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Development phase that delivers the feature. Items with a phase are shown but disabled. */
  phase?: number;
  description: string;
  /** Visible only to platform super administrators. */
  superAdminOnly?: boolean;
  /** Visible only to administrators of the active family. */
  familyAdminOnly?: boolean;
  /** Visible only when the viewer holds this permission in the active family. */
  requires?: FamilyPermission;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: mark('Dashboard'), path: '/dashboard', icon: LucideLayoutDashboard, description: mark('Your families at a glance.') },
  { label: mark('Family Tree'), path: '/tree', icon: LucideNetwork, description: mark('Interactive, zoomable genealogy of the whole family, from the founding ancestor down.') },
  { label: mark('Family Members'), path: '/members', icon: LucideUsers, description: mark('Profiles of every person in the family, with search by name, generation, hometown and more.') },
  { label: mark('Generations'), path: '/generations', icon: LucideLayers, description: mark('Automatically calculated generations, statistics and conflicts awaiting review.') },
  { label: mark('Family Branches'), path: '/branches', icon: LucideGitFork, description: mark('Descendant lines of each child of the founder, with branch statistics.') },
  { label: mark('Relationship Finder'), path: '/relationships', icon: LucideWaypoints, description: mark('Pick two relatives and see exactly how they are related, with the path between them.') },
  { label: mark('Family History'), path: '/history', icon: LucideArchive, description: mark('Stories, oral histories, traditions and a timeline of family events.') },
  { label: mark('Lineage'), path: '/lineage', icon: LucideTrees, description: mark('Lines through mothers and fathers (abusua, ntoro, clan) and their totems.') },
  { label: mark('Places'), path: '/places', icon: LucideMapPinned, description: mark('Where the family was born, lived and gathered, on a map, and how it moved.') },
  { label: mark('Ceremonies'), path: '/ceremonies', icon: LucideDrum, description: mark('Naming ceremonies, weddings, funerals and more: programmes, roles and photos.') },
  { label: mark('Family Funds'), path: '/funds', icon: LucideWallet, requires: 'finance.view', description: mark('Dues and contributions for ceremonies, projects and welfare.') },
  { label: mark('Calendar'), path: '/calendar', icon: LucideCalendarDays, description: mark('Birthdays, anniversaries, days of remembrance and family events.') },
  { label: mark('Family Book'), path: '/book', icon: LucideBookOpen, description: mark('A printable book of the family, a branch or one person: tree, people, stories, timeline and photos.') },
  { label: mark('Photos & Documents'), path: '/media', icon: LucideImages, description: mark('Photographs, recordings and documents with provenance and privacy controls.') },
  { label: mark('Suggestions'), path: '/contributions', icon: LucideMessageSquareText, requires: 'contribution.submit', description: mark('Proposed corrections and additions, and the review queue for moderators.') },
  { label: mark('Invitations'), path: '/invitations', icon: LucideMail, requires: 'invitation.manage', description: mark('Invite relatives by e-mail and let them claim their profile after verification.') },
  { label: mark('Members & Roles'), path: '/family/members', icon: LucideUserCog, requires: 'membership.manage', description: mark('Who has access to the family, their roles and moderated branches.') },
  { label: mark('Change History'), path: '/family/history', icon: LucideHistory, requires: 'audit.view', description: mark('Every change to the family record, with undo and recently removed people.') },
  { label: mark('Import & Duplicates'), path: '/family/import', icon: LucideFileUp, requires: 'family.import', description: mark('Bring people in from a GEDCOM file, and find and merge people recorded twice.') },
  { label: mark('Family Settings'), path: '/family/settings', icon: LucideSlidersHorizontal, familyAdminOnly: true, description: mark('Family details, privacy and the founding ancestor.') },
  { label: mark('Administration'), path: '/admin', icon: LucideShieldCheck, superAdminOnly: true, description: mark('Platform accounts and statistics.') },
  { label: mark('Reports'), path: '/admin/reports', icon: LucideShieldAlert, superAdminOnly: true, description: mark('Content people reported, for review.') },
  { label: mark('Settings'), path: '/settings', icon: LucideSettings, description: mark('Your profile, password, appearance and signed-in devices.') },
];

export const STATS_ICON = LucideChartColumn;
