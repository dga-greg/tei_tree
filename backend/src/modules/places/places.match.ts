/** "Kumásí  (Ashanti)" → "kumasi ashanti": lower case, no accents or punctuation, single spaces. */
export function placeKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Keys a free-text place can match: the whole text, and the part before the first comma ("Kumasi, Ashanti, Ghana" → "kumasi"). */
export function textKeys(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const whole = placeKey(text);
  const first = placeKey(text.split(',')[0] ?? '');
  return [...new Set([whole, first].filter(Boolean))];
}

/** The most specific part of a free-text place, as a suggested place name ("Kumasi, Ashanti" → "Kumasi"). */
export function suggestedName(text: string): string {
  return (text.split(',')[0] ?? '').trim().replace(/\s+/g, ' ');
}

/** Finds the place a free-text value refers to. */
export class PlaceMatcher {
  private readonly byKey = new Map<string, string>();

  constructor(places: { id: string; keys: string[] }[]) {
    for (const p of places) for (const k of p.keys) if (!this.byKey.has(k)) this.byKey.set(k, p.id);
  }

  match(text: string | null | undefined): string | null {
    for (const k of textKeys(text)) {
      const id = this.byKey.get(k);
      if (id) return id;
    }
    return null;
  }
}
