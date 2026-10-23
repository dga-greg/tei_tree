/**
 * Name normalisation and phonetic keys used for member search. Shared so the client can explain
 * matches; the server is the source of truth for stored keys.
 */

/** Lower-case, accent-free, letters/digits only. "Kwamé" → "kwame". */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .trim();
}

export function nameWords(...parts: (string | null | undefined)[]): string[] {
  const words = parts.flatMap((p) => (p ? normalizeName(p).split(/\s+/) : [])).filter((w) => w.length > 0);
  return [...new Set(words)];
}

/** Every word plus its prefixes of two or more letters, so partial names match ("kwa" → "kwame"). */
export function searchTokens(words: string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    for (let i = 2; i <= w.length; i++) out.add(w.slice(0, i));
    if (w.length === 1) out.add(w);
  }
  return [...out];
}

/**
 * A phonetic key tuned for names found in West African and English-language records. Spelling
 * variants that sound alike map to the same key: Kwame/Quame, Mensah/Mensa, Asante/Ashanti,
 * Akosua/Akossua, Philip/Filip, Owusu/Owuusu.
 */
export function phoneticKey(word: string): string {
  let w = normalizeName(word).replace(/[^a-z]/g, '');
  if (!w) return '';
  const rules: [RegExp, string][] = [
    [/ph/g, 'f'],
    [/qu/g, 'kw'],
    [/q/g, 'k'],
    [/ck/g, 'k'],
    [/x/g, 'ks'],
    [/c(?=[eiy])/g, 's'],
    [/c/g, 'k'],
    [/sh/g, 's'],
    [/ch/g, 'k'],
    [/th/g, 't'],
    [/dh/g, 'd'],
    [/gh/g, 'g'],
    [/z/g, 's'],
    [/h$/g, ''],
    [/([bcdfgjklmnpqrstvwxz])h/g, '$1'],
  ];
  for (const [re, rep] of rules) w = w.replace(re, rep);
  const first = /^[aeiouy]/.test(w) ? 'a' : w[0]!;
  const rest = w
    .slice(1)
    .replace(/[aeiouyh]/g, '')
    .replace(/(.)\1+/g, '$1');
  return (first + rest).replace(/(.)\1+/g, '$1');
}

export function phoneticKeys(words: string[]): string[] {
  return [...new Set(words.map(phoneticKey).filter((k) => k.length > 0))];
}

/** "Kofi Mensah", using the preferred name when present. */
export function displayName(p: { firstName: string; preferredName?: string | null; surname?: string | null }): string {
  return [p.preferredName?.trim() || p.firstName, p.surname].filter(Boolean).join(' ');
}

export function fullName(p: {
  title?: string | null;
  firstName: string;
  middleNames?: string | null;
  surname?: string | null;
}): string {
  return [p.title, p.firstName, p.middleNames, p.surname].filter((x) => x && x.trim()).join(' ');
}
