import type { PersonCard } from './members.js';

/**
 * Lineage: the line a person belongs to through their mother (e.g. the Akan abusua) and through their
 * father (e.g. the Akan ntoro, or the clan in patrilineal Ga and Ewe families), and the totem of the line.
 * A person inherits their mother's maternal line and their father's paternal line unless their own is recorded.
 */
export const LINEAGE_SIDES = ['maternal', 'paternal'] as const;
export type LineageSide = (typeof LINEAGE_SIDES)[number];

export interface FamilyLineageSettings {
  maternal: { enabled: boolean; label: string };
  paternal: { enabled: boolean; label: string };
  /** The line the totem follows. */
  totemFollows: LineageSide;
  /** Whether adoptive parents pass on their lines (birth parents always do). */
  throughAdoption: boolean;
}

export const DEFAULT_LINEAGE_SETTINGS: FamilyLineageSettings = {
  maternal: { enabled: true, label: 'Abusua' },
  paternal: { enabled: true, label: 'Ntoro' },
  totemFollows: 'maternal',
  throughAdoption: false,
};

/** A person's value on one line, and where it comes from. */
export interface LineageValue {
  name: string;
  /** Recorded on this person, or inherited from a parent (who may have inherited it in turn). */
  source: 'own' | 'inherited';
  /** For inherited values: the nearest ancestor on whom it is recorded. */
  from: PersonCard | null;
  /** Set when the person's own value differs from the one their parent would pass on. */
  inheritedWouldBe?: string;
}

export interface MemberLineage {
  maternal: LineageValue | null;
  paternal: LineageValue | null;
  totem: LineageValue | null;
}

export interface LineageGroup {
  side: LineageSide;
  name: string;
  /** Totems recorded in this line (usually one). */
  totems: string[];
  members: number;
  living: number;
  /** People on whom the line is recorded (rather than inherited), earliest born first: the line's known roots. */
  roots: PersonCard[];
  /** Everyone in the line the viewer may see, by generation then name (at most 500). */
  people: PersonCard[];
  /** People whose own value differs from what their parent would pass on. */
  differences: number;
}

export interface LineageOverview {
  settings: FamilyLineageSettings;
  side: LineageSide;
  groups: LineageGroup[];
  /** People with no line on this side (nothing recorded on them or their ancestors). */
  unknown: number;
}
