import {
  LucideLayoutDashboard,
  LucideNetwork,
  LucideSettings,
  LucideShieldCheck,
  LucideUsers,
  LucideChartColumn,
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
  { label: mark('Dashboard'), path: '/dashboard', icon: LucideLayoutDashboard, description: mark('Your family at a glance.') },
  { label: mark('Family Tree'), path: '/tree', icon: LucideNetwork, description: mark('The whole family from the family head down, with everyone’s family ID.') },
  { label: mark('Family Members'), path: '/members', icon: LucideUsers, description: mark('Everyone in the family: find people by name or family ID, add and edit them.') },
  { label: mark('Settings'), path: '/settings', icon: LucideSettings, description: mark('The family and its head, your profile, password and appearance.') },
  { label: mark('Administration'), path: '/admin', icon: LucideShieldCheck, superAdminOnly: true, description: mark('Platform accounts and statistics.') },
];

export const STATS_ICON = LucideChartColumn;
