import { normalizeName, phoneticKey, type MatchStrength } from '@fh/contracts';

/**
 * Scores how likely two person records describe the same person. Used to suggest matches between
 * an imported file and the family, and to find duplicates inside a family. Pure and deterministic.
 *
 * The first names must be related (same, sounding alike, an initial, or one's first name is the
 * other's middle name); surnames, dates, gender and life status then add or subtract evidence.
 */

export interface MatchCandidate {
  id: string;
  firstName: string;
  middleNames?: string | null;
  surname?: string | null;
  maidenName?: string | null;
  preferredName?: string | null;
  previousNames?: string[] | null;
  gender?: string | null;
  vitalStatus?: string | null;
  birthDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  deathDate?: { year?: number | null } | null;
}

export interface MatchResult {
  score: number;
  strength: MatchStrength;
  reasons: string[];
}

export const STRONG_MATCH = 80;
export const POSSIBLE_MATCH = 60;

const words = (...parts: (string | null | undefined)[]) =>
  parts.flatMap((p) => (p ? normalizeName(p).split(/\s+/) : [])).filter((w) => w.length > 0);

function firstNames(p: MatchCandidate): string[] {
  return [...new Set(words(p.firstName, p.preferredName))];
}

function surnames(p: MatchCandidate): string[] {
  const fromPrevious = (p.previousNames ?? []).map((n) => words(n).slice(-1)[0]).filter((w): w is string => !!w);
  return [...new Set([...words(p.surname), ...words(p.maidenName), ...fromPrevious])];
}

const isUnknown = (w: string) => w === 'unknown' || w === 'living';

function nameRelation(a: MatchCandidate, b: MatchCandidate): { points: number; reason: string } | null {
  const fa = firstNames(a).filter((w) => !isUnknown(w));
  const fb = firstNames(b).filter((w) => !isUnknown(w));
  if (!fa.length || !fb.length) return null;
  if (fa.some((w) => fb.includes(w))) return { points: 35, reason: 'Same first name' };
  const ka = new Set(fa.map(phoneticKey));
  if (fb.some((w) => ka.has(phoneticKey(w)))) return { points: 25, reason: 'First names sound alike' };
  const ma = words(a.middleNames);
  const mb = words(b.middleNames);
  if (fa.some((w) => mb.includes(w)) || fb.some((w) => ma.includes(w))) return { points: 18, reason: 'First name matches a middle name' };
  const initial = (list: string[], other: string[]) => list.some((w) => w.length === 1 && other.some((o) => o.startsWith(w)));
  if (initial(fa, fb) || initial(fb, fa)) return { points: 12, reason: 'First initial matches' };
  return null;
}

export function scoreMatch(a: MatchCandidate, b: MatchCandidate): MatchResult | null {
  if (a.gender && b.gender && a.gender !== b.gender && ['male', 'female'].includes(a.gender) && ['male', 'female'].includes(b.gender)) return null;
  const first = nameRelation(a, b);
  if (!first) return null;
  let score = first.points;
  const reasons = [first.reason];

  const sa = surnames(a);
  const sb = surnames(b);
  if (sa.length && sb.length) {
    if (sa.some((w) => sb.includes(w))) {
      score += 30;
      reasons.push('Same surname');
    } else if (sa.some((w) => sb.map(phoneticKey).includes(phoneticKey(w)))) {
      score += 25;
      reasons.push('Surnames sound alike');
    } else {
      score -= 25;
    }
  }

  const ya = a.birthDate?.year ?? null;
  const yb = b.birthDate?.year ?? null;
  if (ya && yb) {
    const gap = Math.abs(ya - yb);
    if (gap === 0) {
      const sameDay = a.birthDate?.month && a.birthDate.month === b.birthDate?.month && a.birthDate.day && a.birthDate.day === b.birthDate?.day;
      score += sameDay ? 30 : 20;
      reasons.push(sameDay ? 'Same date of birth' : 'Born the same year');
    } else if (gap <= 2) {
      score += 10;
      reasons.push('Born within two years');
    } else if (gap > 5) {
      score -= 40;
    }
  }
  const da = a.deathDate?.year ?? null;
  const db = b.deathDate?.year ?? null;
  if (da && db) {
    const gap = Math.abs(da - db);
    if (gap === 0) {
      score += 15;
      reasons.push('Died the same year');
    } else if (gap <= 2) score += 5;
    else if (gap > 5) score -= 30;
  }
  if ((a.vitalStatus === 'living' && b.vitalStatus === 'deceased') || (a.vitalStatus === 'deceased' && b.vitalStatus === 'living')) score -= 25;
  if (a.gender && a.gender === b.gender) score += 3;

  score = Math.max(0, Math.min(100, score));
  if (score < POSSIBLE_MATCH) return null;
  return { score, strength: score >= STRONG_MATCH ? 'strong' : 'possible', reasons };
}

/** Keys used to compare only people who could match: the sounds of their first names. */
export function blockingKeys(p: MatchCandidate): string[] {
  return [...new Set([...firstNames(p), ...words(p.middleNames)].filter((w) => !isUnknown(w)).map((w) => (w.length === 1 ? w : phoneticKey(w))).filter(Boolean))];
}
