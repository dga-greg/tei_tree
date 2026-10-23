import { describe, expect, it } from 'vitest';
import { nameWords, normalizeName, phoneticKey, searchTokens } from './names.js';

describe('name normalisation', () => {
  it('removes accents and punctuation', () => {
    expect(normalizeName('  Kwamé ')).toBe('kwame');
    expect(normalizeName("Nana Ama O'Brien-Asante")).toBe('nana ama obrienasante');
    expect(nameWords('Kofi', 'Kofi Yaw', 'Mensah')).toEqual(['kofi', 'yaw', 'mensah']);
  });

  it('indexes prefixes for partial matching', () => {
    expect(searchTokens(['kofi'])).toEqual(['ko', 'kof', 'kofi']);
  });
});

describe('phonetic keys', () => {
  const same = [
    ['Kwame', 'Quame'],
    ['Kwame', 'Kwamé'],
    ['Mensah', 'Mensa'],
    ['Asante', 'Ashanti'],
    ['Akosua', 'Akossua'],
    ['Philip', 'Filip'],
    ['Owusu', 'Owuusu'],
    ['Boateng', 'Boatheng'],
    ['Catherine', 'Katherine'],
  ];
  it.each(same)('%s sounds like %s', (a, b) => {
    expect(phoneticKey(a!)).toBe(phoneticKey(b!));
  });

  const different = [
    ['Kofi', 'Kwame'],
    ['Ama', 'Esi'],
    ['Mensah', 'Boateng'],
  ];
  it.each(different)('%s does not sound like %s', (a, b) => {
    expect(phoneticKey(a!)).not.toBe(phoneticKey(b!));
  });
});
