export const DATE_QUALIFIERS = ['exact', 'about', 'before', 'after', 'between', 'estimated'] as const;
export type DateQualifier = (typeof DATE_QUALIFIERS)[number];

/**
 * A date that may be partial or approximate — historical ancestors rarely have exact dates.
 * `sortKey` is derived (year*10000 + month*100 + day, unknown parts = 0) and only used for ordering.
 */
export interface FuzzyDate {
  year?: number;
  month?: number;
  day?: number;
  qualifier: DateQualifier;
  /** Upper bound year when qualifier is `between`. */
  endYear?: number;
  /** Original wording from a source, e.g. "the year of the great flood". */
  text?: string;
  sortKey?: number | null;
}

export function fuzzyDateSortKey(date: Pick<FuzzyDate, 'year' | 'month' | 'day'> | null | undefined): number | null {
  if (!date?.year) return null;
  return date.year * 10000 + (date.month ?? 0) * 100 + (date.day ?? 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Human-readable rendering, e.g. "about 1890", "between 1900 and 1910", "12 Mar 1954". */
export function formatFuzzyDate(date: FuzzyDate | null | undefined): string {
  if (!date) return '';
  if (!date.year) return date.text ?? '';
  const parts: string[] = [];
  if (date.day && date.month) parts.push(String(date.day));
  if (date.month) parts.push(MONTHS[date.month - 1] ?? '');
  parts.push(String(date.year));
  const core = parts.join(' ');
  switch (date.qualifier) {
    case 'exact':
      return core;
    case 'about':
      return `about ${core}`;
    case 'estimated':
      return `est. ${core}`;
    case 'before':
      return `before ${core}`;
    case 'after':
      return `after ${core}`;
    case 'between':
      return date.endYear ? `between ${core} and ${date.endYear}` : `from ${core}`;
  }
}
