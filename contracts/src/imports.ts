import type { FuzzyDate } from './dates.js';
import type { Gender, PersonCard, VitalStatus } from './members.js';

// ------------------------------------------------------------------ GEDCOM import

/** Largest GEDCOM file accepted, in MB. */
export const GEDCOM_MAX_MB = 30;
/** Most people one import may add. */
export const GEDCOM_MAX_PEOPLE = 20_000;

/** A person read from the file, as shown in the preview. `ref` is the record's id in the file (e.g. "I12"). */
export interface ImportPersonPreview {
  ref: string;
  name: string;
  gender: Gender | null;
  vitalStatus: VitalStatus;
  birthDate: FuzzyDate | null;
  deathDate: FuzzyDate | null;
  birthPlace: string;
}

export type MatchStrength = 'strong' | 'possible';

/** A person in the file who may already be in the family. */
export interface ImportMatch {
  person: ImportPersonPreview;
  existing: PersonCard;
  score: number;
  strength: MatchStrength;
  /** Plain-language reasons, e.g. "Same surname", "Born the same year". */
  reasons: string[];
}

export interface ImportWarning {
  /** File record the warning is about, when there is one. */
  ref?: string;
  message: string;
}

export interface GedcomImportCounts {
  people: number;
  families: number;
  parentLinks: number;
  partnerships: number;
}

export interface GedcomImportPreview {
  fileName: string;
  /** Program that wrote the file, GEDCOM version and character set, as declared in its header. */
  source: { system: string; version: string; charset: string };
  counts: GedcomImportCounts;
  /** The first people in the file (at most 100). */
  sample: ImportPersonPreview[];
  matches: ImportMatch[];
  warnings: ImportWarning[];
  /** Total warnings; only the first 200 are listed. */
  warningCount: number;
}

/**
 * Choices made on the preview: which people in the file are people already in the family
 * (file ref → member id), and whether their empty details are filled in from the file.
 */
export interface GedcomImportDecisions {
  same: Record<string, string>;
  fillBlanks: boolean;
  /**
   * Whether links from the file count as verified. Generation numbers follow verified links only, so
   * unverified imports leave people with provisional numbers until someone checks each link.
   */
  verifyLinks: boolean;
}

export const IMPORT_STATUSES = ['active', 'undone'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export interface ImportBatchView {
  id: string;
  fileName: string;
  source: string;
  status: ImportStatus;
  createdAt: string;
  createdBy: string | null;
  undoneAt: string | null;
  counts: {
    created: number;
    matched: number;
    filled: number;
    parentLinks: number;
    partnerships: number;
    skipped: number;
  };
  warningCount: number;
}

// ------------------------------------------------------------------ duplicates and merging

export interface DuplicatePair {
  a: PersonCard;
  b: PersonCard;
  score: number;
  strength: MatchStrength;
  reasons: string[];
}

/** Details chosen field by field when merging two people. Lists (education, sources…) are always combined. */
export const MERGE_FIELDS = [
  'title',
  'firstName',
  'middleNames',
  'surname',
  'maidenName',
  'preferredName',
  'gender',
  'vitalStatus',
  'birthDate',
  'birthPlace',
  'deathDate',
  'deathPlace',
  'nationality',
  'hometown',
  'biography',
  'profilePhotoMediaId',
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export const MERGE_FIELD_LABELS: Record<MergeField, string> = {
  title: 'Title',
  firstName: 'First name',
  middleNames: 'Middle names',
  surname: 'Surname',
  maidenName: 'Maiden name',
  preferredName: 'Known as',
  gender: 'Gender',
  vitalStatus: 'Living or deceased',
  birthDate: 'Date of birth',
  birthPlace: 'Place of birth',
  deathDate: 'Date of death',
  deathPlace: 'Place of death',
  nationality: 'Nationality',
  hometown: 'Hometown',
  biography: 'Life story',
  profilePhotoMediaId: 'Profile photo',
};

/** For each field, whose value the merged person keeps. Missing fields keep the kept person's value. */
export type MergeChoices = Partial<Record<MergeField, 'keep' | 'other'>>;

export interface MergeRequest {
  otherId: string;
  choices: MergeChoices;
  /** Versions seen on the comparison screen; the merge is refused if either person changed since. */
  keepVersion: number;
  otherVersion: number;
}

export interface MergeView {
  id: string;
  keep: PersonCard | null;
  otherName: string;
  status: ImportStatus;
  createdAt: string;
  createdBy: string | null;
  undoneAt: string | null;
  linksMoved: number;
  linksDropped: number;
  itemsMoved: number;
}
