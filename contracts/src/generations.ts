import type { BirthEraKey } from './eras.js';
import type { GenerationStatus, PersonCard } from './members.js';

export interface GenerationBucketView {
  number: number;
  total: number;
  living: number;
  deceased: number;
  unknown: number;
  earliestBirthYear: number | null;
  latestBirthYear: number | null;
}

export type RecalculationStatus = 'idle' | 'pending' | 'running';

export interface GenerationState {
  status: RecalculationStatus;
  completedAt: string | null;
}

export interface GenerationSummary {
  state: GenerationState;
  founder: PersonCard | null;
  computedAt: string | null;
  totals: { members: number; generations: number; conflicts: number; unconnected: number; marriedIn: number };
  byGeneration: GenerationBucketView[];
  /** People by era of birth (Gen X, Millennials…), counted from the birth dates the viewer may see. */
  byEra: { era: BirthEraKey; count: number }[];
  /** People whose era is not known: no birth year, a vague one, or hidden from the viewer. */
  eraUnknown: number;
}

export interface GenerationTrendPoint {
  /** ISO date (day) of the last recalculation that day. */
  date: string;
  members: number;
  generations: number;
}

export interface GenerationConflictView {
  person: PersonCard;
  candidates: number[];
  /** Present when an administrator has resolved the conflict. */
  resolution: { number: number; reason: string; at: string } | null;
}

export interface GenerationOverrideRequest {
  number: number;
  reason: string;
}

export interface FamilyDashboard {
  stats: {
    members: number;
    generations: number;
    living: number;
    deceased: number;
    branches: number;
    /** Proposals waiting on the viewer: to review (reviewers) or to be answered (their own). */
    pendingContributions: number;
    conflicts: number;
  };
  byGeneration: GenerationBucketView[];
  recentlyAdded: PersonCard[];
  /** People added per month over the last 12 months, oldest first. */
  growth: { month: string; added: number }[];
  state: GenerationState;
}

export const GENERATION_STATUS_LABELS: Record<GenerationStatus, string> = {
  founder: 'Founding ancestor',
  computed: 'Calculated',
  conflict: 'Conflicting paths',
  married_in: 'Married into the family',
  unconnected: 'Not connected to the founder',
  unverified_path: 'Connected only by unverified links',
  pending: 'Not yet calculated',
};
