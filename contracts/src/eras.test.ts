import { describe, expect, it } from 'vitest';
import { BIRTH_ERAS, birthEraOf } from './eras.js';

describe('birth eras', () => {
  it('places a birth year in its era', () => {
    expect(birthEraOf({ year: 1920, qualifier: 'exact' })?.key).toBe('greatest');
    expect(birthEraOf({ year: 1965, month: 1, day: 1, qualifier: 'exact' })?.key).toBe('genx');
    expect(birthEraOf({ year: 1980, qualifier: 'exact' })?.key).toBe('genx');
    expect(birthEraOf({ year: 1981, qualifier: 'about' })?.key).toBe('millennials');
    expect(birthEraOf({ year: 2015, qualifier: 'estimated' })?.key).toBe('alpha');
  });

  it('leaves out vague, unknown or out-of-range years', () => {
    expect(birthEraOf(null)).toBeNull();
    expect(birthEraOf({ qualifier: 'exact', text: 'the year of the flood' })).toBeNull();
    expect(birthEraOf({ year: 1970, qualifier: 'before' })).toBeNull();
    expect(birthEraOf({ year: 1970, endYear: 1990, qualifier: 'between' })).toBeNull();
    expect(birthEraOf({ year: 1970, endYear: 1975, qualifier: 'between' })?.key).toBe('genx');
    expect(birthEraOf({ year: 1850, qualifier: 'exact' })).toBeNull();
  });

  it('has no gaps between eras', () => {
    for (let i = 1; i < BIRTH_ERAS.length; i++) expect(BIRTH_ERAS[i]!.from).toBe(BIRTH_ERAS[i - 1]!.to + 1);
  });
});
