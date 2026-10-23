import type { FamilyLineageSettings, LineageSide } from '@fh/contracts';

/**
 * Works out each person's maternal line, paternal line and totem. Pure.
 *
 * A value recorded on a person is theirs. Otherwise it is inherited: the maternal line from the mother,
 * the paternal line from the father, and the totem along the line the family chooses — each parent
 * passing on what they have, recorded or inherited. Only birth parents pass lines on, plus adoptive
 * parents when the family says so (a birth parent is preferred when there are both); disputed links never do.
 * A mother is a parent recorded as female and a father a parent recorded as male.
 */

export interface LineagePerson {
  id: string;
  gender?: string | null;
  maternalLine?: string | null;
  paternalLine?: string | null;
  totem?: string | null;
}

export interface LineageLink {
  parent: string;
  child: string;
  subtype: string;
  verification?: string;
}

export interface ResolvedValue {
  name: string;
  /** Person on whom the value is recorded (the person themselves when it is their own). */
  sourceId: string;
  /** For a recorded value: what the parent would have passed on, when that is different. */
  inheritedWouldBe?: string;
}

export interface ResolvedLineage {
  maternal: ResolvedValue | null;
  paternal: ResolvedValue | null;
  totem: ResolvedValue | null;
}

type Field = 'maternalLine' | 'paternalLine' | 'totem';
const norm = (s: string) => s.trim().toLowerCase();

export function computeLineage(people: LineagePerson[], links: LineageLink[], settings: FamilyLineageSettings): Map<string, ResolvedLineage> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const passes = (subtype: string) => subtype === 'biological' || (settings.throughAdoption && subtype === 'adoptive');
  // Mother and father of each person: the birth parent when there is one, otherwise an adoptive parent.
  const parentOf = { maternal: new Map<string, { id: string; birth: boolean }>(), paternal: new Map<string, { id: string; birth: boolean }>() };
  for (const l of links) {
    if (l.verification === 'disputed' || !passes(l.subtype)) continue;
    const parent = byId.get(l.parent);
    if (!parent || !byId.has(l.child)) continue;
    const side: LineageSide | null = parent.gender === 'female' ? 'maternal' : parent.gender === 'male' ? 'paternal' : null;
    if (!side) continue;
    const current = parentOf[side].get(l.child);
    const birth = l.subtype === 'biological';
    if (!current || (birth && !current.birth)) parentOf[side].set(l.child, { id: l.parent, birth });
  }

  const memo: Record<Field, Map<string, ResolvedValue | null>> = { maternalLine: new Map(), paternalLine: new Map(), totem: new Map() };
  const sideOf: Record<Field, LineageSide> = { maternalLine: 'maternal', paternalLine: 'paternal', totem: settings.totemFollows };

  /** Iterative, so very deep lines cannot overflow the stack. */
  function resolve(field: Field, start: string): ResolvedValue | null {
    const cache = memo[field];
    const chain: string[] = [];
    let id: string | undefined = start;
    let found: ResolvedValue | null = null;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      if (cache.has(id)) {
        found = cache.get(id)!;
        break;
      }
      const own = byId.get(id)?.[field]?.trim();
      if (own) {
        found = { name: own, sourceId: id };
        // What would the parent have passed on?
        const parent = parentOf[sideOf[field]].get(id)?.id;
        const inherited = parent ? resolve(field, parent) : null;
        if (inherited && norm(inherited.name) !== norm(own)) found.inheritedWouldBe = inherited.name;
        cache.set(id, found);
        break;
      }
      chain.push(id);
      id = parentOf[sideOf[field]].get(id)?.id;
    }
    // Everyone passed on the way inherits the same value (without the "would be" note, which is about the recorded person).
    const passed = found ? { name: found.name, sourceId: found.sourceId } : null;
    for (const c of chain) cache.set(c, passed);
    return start === found?.sourceId ? found : passed;
  }

  const out = new Map<string, ResolvedLineage>();
  for (const p of people) {
    out.set(p.id, {
      maternal: settings.maternal.enabled ? resolve('maternalLine', p.id) : null,
      paternal: settings.paternal.enabled ? resolve('paternalLine', p.id) : null,
      totem: resolve('totem', p.id),
    });
  }
  return out;
}
