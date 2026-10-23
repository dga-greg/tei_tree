import type { FuzzyDate } from './dates.js';

/**
 * Generations by era of birth (Gen X, Millennials…): people born in the same years, whatever their place in the
 * family line. Not to be confused with the family's own generations (G1 the founder, G2 their children…).
 * Year ranges follow common usage (Pew Research Center and others); sources differ by a year or two.
 */
export const BIRTH_ERAS = [
  { key: 'lost', from: 1883, to: 1900 },
  { key: 'greatest', from: 1901, to: 1927 },
  { key: 'silent', from: 1928, to: 1945 },
  { key: 'boomers', from: 1946, to: 1964 },
  { key: 'genx', from: 1965, to: 1980 },
  { key: 'millennials', from: 1981, to: 1996 },
  { key: 'genz', from: 1997, to: 2012 },
  { key: 'alpha', from: 2013, to: 2024 },
  { key: 'beta', from: 2025, to: 2039 },
] as const;
export type BirthEra = (typeof BIRTH_ERAS)[number];
export type BirthEraKey = BirthEra['key'];

/** Names of the eras: `name` for headings, `short` for a person's tag ("Gen X", "Millennial"). */
export const BIRTH_ERA_LABELS: Record<BirthEraKey, { name: string; short: string }> = {
  lost: { name: 'Lost Generation', short: 'Lost Gen' },
  greatest: { name: 'Greatest Generation', short: 'Greatest Gen' },
  silent: { name: 'Silent Generation', short: 'Silent Gen' },
  boomers: { name: 'Baby Boomers', short: 'Baby Boomer' },
  genx: { name: 'Generation X', short: 'Gen X' },
  millennials: { name: 'Millennials (Gen Y)', short: 'Millennial' },
  genz: { name: 'Generation Z', short: 'Gen Z' },
  alpha: { name: 'Generation Alpha', short: 'Gen Alpha' },
  beta: { name: 'Generation Beta', short: 'Gen Beta' },
};

/**
 * The era of a birth date, when the year is known well enough: exact, about or estimated years, or a "between"
 * range inside one era. Null for vaguer dates, years outside the eras, or a date the viewer may not see.
 */
export function birthEraOf(date: FuzzyDate | null | undefined): BirthEra | null {
  if (!date?.year) return null;
  const find = (year: number) => BIRTH_ERAS.find((e) => year >= e.from && year <= e.to) ?? null;
  switch (date.qualifier) {
    case 'before':
    case 'after':
      return null;
    case 'between': {
      const era = find(date.year);
      return era && (!date.endYear || find(date.endYear) === era) ? era : null;
    }
    default:
      return find(date.year);
  }
}
