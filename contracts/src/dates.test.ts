import { describe, expect, it } from 'vitest';
import { formatFuzzyDate, fuzzyDateSortKey } from './dates.js';

describe('fuzzy dates', () => {
  it('formats partial and approximate dates', () => {
    expect(formatFuzzyDate({ year: 1890, qualifier: 'about' })).toBe('about 1890');
    expect(formatFuzzyDate({ year: 1954, month: 3, day: 12, qualifier: 'exact' })).toBe('12 Mar 1954');
    expect(formatFuzzyDate({ year: 1900, endYear: 1910, qualifier: 'between' })).toBe('between 1900 and 1910');
    expect(formatFuzzyDate({ qualifier: 'estimated', text: 'before independence' })).toBe('before independence');
  });

  it('builds a sort key that tolerates unknown parts', () => {
    expect(fuzzyDateSortKey({ year: 1954, month: 3, day: 12 })).toBe(19540312);
    expect(fuzzyDateSortKey({ year: 1890 })).toBe(18900000);
    expect(fuzzyDateSortKey({})).toBeNull();
  });
});
