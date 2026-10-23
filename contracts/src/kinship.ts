import type { PersonCard } from './members.js';
import type { VerificationState } from './relationships.js';

export const KINSHIP_KINDS = ['self', 'blood', 'partner', 'marriage', 'step', 'not_found'] as const;
export type KinshipKind = (typeof KINSHIP_KINDS)[number];

/** One link in the chain between two people. `label` says what `to` is to `from` (e.g. "father"). */
export interface KinshipStep {
  from: string;
  to: string;
  relation: 'parent' | 'child' | 'partner';
  label: string;
  subtype: string;
  verification: VerificationState;
}

export interface KinshipResult {
  a: PersonCard;
  b: PersonCard;
  kind: KinshipKind;
  /** What A is to B, e.g. "great-uncle", "first cousin once removed", "sister-in-law". */
  term: string | null;
  /** What B is to A. */
  reciprocal: string | null;
  /** One sentence, e.g. "Kwame Mensah is Abena Mensah's great-uncle." */
  summary: string;
  /** How the answer was reached, in plain language. */
  explanation: string[];
  /** For blood relations: generations from each person up to the closest common ancestor. */
  blood: { fromA: number; fromB: number; cousinDegree: number | null; removed: number | null; half: boolean | null } | null;
  commonAncestors: PersonCard[];
  path: { people: PersonCard[]; steps: KinshipStep[] };
  /** `verified` only when every link on the path is verified. */
  confidence: 'verified' | 'includes_unverified';
  viaAdoption: boolean;
  /** Blood relatives who are also recorded as partners (e.g. a cousin marriage). */
  alsoPartners: boolean;
}
