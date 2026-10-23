import type { FuzzyDate } from '@fh/contracts';

/**
 * GEDCOM 5.5.1 (lineage-linked, UTF-8) writer. Pure: takes plain records and returns the file text,
 * so it is easy to test and independent of the database.
 *
 * Mapping notes:
 * - People → INDI with NAME (`Given /Surname/`), GIVN, SURN, NICK, SEX, BIRT, DEAT, OCCU, EDUC, NOTE.
 * - Families → FAM. A FAM is made for every recorded partnership and for every distinct set of parents
 *   of a child; children are linked with CHIL, and their link type with FAMC.PEDI
 *   (birth / adopted / foster; step and guardian links are not parent links in GEDCOM, so they are
 *   written as `PEDI foster` with a NOTE explaining the original type).
 * - Fuzzy dates map to GEDCOM date modifiers (ABT, BEF, AFT, BET … AND …, EST); text-only dates become
 *   date phrases in parentheses.
 */

export interface GedcomPerson {
  id: string;
  firstName: string;
  middleNames?: string;
  surname?: string;
  maidenName?: string;
  preferredName?: string;
  title?: string;
  gender?: string | null;
  vitalStatus?: string;
  birthDate?: FuzzyDate | null;
  birthPlace?: string;
  deathDate?: FuzzyDate | null;
  deathPlace?: string;
  occupations?: string[];
  education?: string[];
  biography?: string;
  /** Replace with "Living" and drop details (for sharing exports). */
  privatised?: boolean;
}

export interface GedcomParentLink {
  parentId: string;
  childId: string;
  subtype: string;
}

export interface GedcomPartnership {
  id: string;
  personA: string;
  personB: string;
  subtype: string;
  status?: string | null;
  startDate?: FuzzyDate | null;
  endDate?: FuzzyDate | null;
}

export interface GedcomInput {
  familyName: string;
  exportedAt: Date;
  people: GedcomPerson[];
  parentLinks: GedcomParentLink[];
  partnerships: GedcomPartnership[];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MAX_LINE_VALUE = 200;

/** GEDCOM date value for a fuzzy date, or null when there is nothing to say. */
export function gedcomDate(d: FuzzyDate | null | undefined): string | null {
  if (!d) return null;
  if (!d.year) return d.text ? `(${d.text.replace(/[()]/g, '')})` : null;
  const exact = [d.day && d.month ? String(d.day) : null, d.month ? MONTHS[d.month - 1] : null, String(d.year)].filter(Boolean).join(' ');
  switch (d.qualifier) {
    case 'about':
      return `ABT ${exact}`;
    case 'before':
      return `BEF ${exact}`;
    case 'after':
      return `AFT ${exact}`;
    case 'estimated':
      return `EST ${exact}`;
    case 'between':
      return d.endYear ? `BET ${exact} AND ${d.endYear}` : `ABT ${exact}`;
    default:
      return exact;
  }
}

/** GEDCOM forbids '@' in values except as pointers ('@@' escapes it) and line breaks. */
function clean(value: string): string {
  return value.replace(/@/g, '@@').replace(/[\r\n]+/g, ' ').trim();
}

class Writer {
  readonly lines: string[] = [];

  line(level: number, tag: string, value?: string | null, xref?: string): void {
    this.lines.push([String(level), xref ? `@${xref}@` : null, tag, value ?? null].filter((x) => x !== null && x !== '').join(' '));
  }

  /** Long or multi-line text, split with CONT (new line) and CONC (continuation). */
  text(level: number, tag: string, value: string): void {
    const paragraphs = value.replace(/\r/g, '').split('\n');
    paragraphs.forEach((para, i) => {
      const safe = para.replace(/@/g, '@@');
      const chunks = safe.length ? safe.match(new RegExp(`.{1,${MAX_LINE_VALUE}}`, 'gsu'))! : [''];
      chunks.forEach((chunk, j) => {
        if (i === 0 && j === 0) this.line(level, tag, chunk);
        else this.line(level + 1, j === 0 ? 'CONT' : 'CONC', chunk);
      });
    });
  }

  event(level: number, tag: string, date: FuzzyDate | null | undefined, place?: string, knownWithoutDetails = false): void {
    const value = gedcomDate(date);
    if (!value && !place && !knownWithoutDetails) return;
    this.line(level, tag, !value && !place ? 'Y' : null);
    if (value) this.line(level + 1, 'DATE', value);
    if (place) this.line(level + 1, 'PLAC', clean(place));
  }
}

const SEX: Record<string, string> = { male: 'M', female: 'F' };
const PEDI: Record<string, string> = { biological: 'birth', adoptive: 'adopted', foster: 'foster', step: 'foster', guardian: 'foster' };

export function toGedcom(input: GedcomInput): string {
  const w = new Writer();
  const indiId = new Map(input.people.map((p, i) => [p.id, `I${i + 1}`]));
  const people = new Map(input.people.map((p) => [p.id, p]));

  // ---- families: partnerships, then parent sets (merged with a matching partnership)
  interface Fam { id: string; parents: string[]; children: { id: string; subtype: string }[]; partnership?: GedcomPartnership }
  const fams: Fam[] = [];
  const famByParents = new Map<string, Fam>();
  const keyOf = (ids: string[]) => [...ids].sort().join('|');
  for (const p of input.partnerships) {
    if (!indiId.has(p.personA) || !indiId.has(p.personB)) continue;
    const fam: Fam = { id: `F${fams.length + 1}`, parents: [p.personA, p.personB], children: [], partnership: p };
    fams.push(fam);
    if (!famByParents.has(keyOf(fam.parents))) famByParents.set(keyOf(fam.parents), fam);
  }
  // Group each child's parents: birth parents together, each other kind of link on its own.
  const byChild = new Map<string, GedcomParentLink[]>();
  for (const l of input.parentLinks) {
    if (!indiId.has(l.parentId) || !indiId.has(l.childId)) continue;
    byChild.set(l.childId, [...(byChild.get(l.childId) ?? []), l]);
  }
  for (const [childId, links] of byChild) {
    const groups = new Map<string, GedcomParentLink[]>();
    for (const l of links) {
      const kind = l.subtype === 'biological' || l.subtype === 'unknown' ? 'birth' : l.subtype;
      groups.set(kind, [...(groups.get(kind) ?? []), l]);
    }
    for (const [kind, group] of groups) {
      // More than two parents of one kind cannot be one GEDCOM family: pair them in order.
      for (let i = 0; i < group.length; i += 2) {
        const parents = group.slice(i, i + 2).map((l) => l.parentId);
        const key = keyOf(parents);
        let fam = famByParents.get(key);
        if (!fam) {
          fam = { id: `F${fams.length + 1}`, parents, children: [] };
          fams.push(fam);
          famByParents.set(key, fam);
        }
        fam.children.push({ id: childId, subtype: kind === 'birth' ? 'biological' : kind });
      }
    }
  }
  const famsOf = new Map<string, string[]>();
  const famcOf = new Map<string, { fam: string; subtype: string }[]>();
  for (const f of fams) {
    for (const p of f.parents) famsOf.set(p, [...(famsOf.get(p) ?? []), f.id]);
    for (const c of f.children) famcOf.set(c.id, [...(famcOf.get(c.id) ?? []), { fam: f.id, subtype: c.subtype }]);
  }

  // ---- header
  w.line(0, 'HEAD');
  w.line(1, 'SOUR', 'FAMILY_HERITAGE');
  w.line(2, 'NAME', 'Family Heritage');
  w.line(1, 'DATE', `${input.exportedAt.getUTCDate()} ${MONTHS[input.exportedAt.getUTCMonth()]} ${input.exportedAt.getUTCFullYear()}`);
  w.line(1, 'SUBM', '@U1@');
  w.line(1, 'FILE', `${clean(input.familyName).replace(/[^\w .-]+/g, '')}.ged`);
  w.line(1, 'GEDC');
  w.line(2, 'VERS', '5.5.1');
  w.line(2, 'FORM', 'LINEAGE-LINKED');
  w.line(1, 'CHAR', 'UTF-8');
  w.line(0, 'SUBM', null, 'U1');
  w.line(1, 'NAME', clean(input.familyName));

  // ---- individuals
  for (const p of input.people) {
    const id = indiId.get(p.id)!;
    w.line(0, 'INDI', null, id);
    if (p.privatised) {
      w.line(1, 'NAME', `Living /${clean(p.surname ?? '')}/`);
      w.line(1, 'RESN', 'privacy');
    } else {
      const given = [p.firstName, p.middleNames].filter(Boolean).map((s) => clean(s!)).join(' ');
      w.line(1, 'NAME', `${given} /${clean(p.surname ?? '')}/`);
      if (p.title) w.line(2, 'NPFX', clean(p.title));
      if (given) w.line(2, 'GIVN', given);
      if (p.surname) w.line(2, 'SURN', clean(p.surname));
      if (p.preferredName) w.line(2, 'NICK', clean(p.preferredName));
      if (p.maidenName && p.maidenName !== p.surname) {
        w.line(1, 'NAME', `${given} /${clean(p.maidenName)}/`);
        w.line(2, 'TYPE', 'birth');
      }
      w.line(1, 'SEX', SEX[p.gender ?? ''] ?? 'U');
      w.event(1, 'BIRT', p.birthDate, p.birthPlace);
      w.event(1, 'DEAT', p.deathDate, p.deathPlace, p.vitalStatus === 'deceased');
      for (const o of p.occupations ?? []) w.line(1, 'OCCU', clean(o));
      for (const e of p.education ?? []) w.line(1, 'EDUC', clean(e));
      if (p.biography?.trim()) w.text(1, 'NOTE', p.biography.trim());
    }
    for (const c of famcOf.get(p.id) ?? []) {
      w.line(1, 'FAMC', `@${c.fam}@`);
      w.line(2, 'PEDI', PEDI[c.subtype] ?? 'birth');
      if (c.subtype === 'step' || c.subtype === 'guardian') w.line(2, 'NOTE', c.subtype === 'step' ? 'Step-parent link' : 'Guardian link');
    }
    for (const f of famsOf.get(p.id) ?? []) w.line(1, 'FAMS', `@${f}@`);
  }

  // ---- families
  for (const f of fams) {
    w.line(0, 'FAM', null, f.id);
    // GEDCOM 5.5.1 only has HUSB and WIFE: women are WIFE, men HUSB; otherwise first is HUSB.
    const [a, b] = f.parents;
    const pa = a ? people.get(a) : undefined;
    const pb = b ? people.get(b) : undefined;
    let husb = a;
    let wife = b;
    if (pa?.gender === 'female' || pb?.gender === 'male') [husb, wife] = [b, a];
    if (husb) w.line(1, 'HUSB', `@${indiId.get(husb)}@`);
    if (wife) w.line(1, 'WIFE', `@${indiId.get(wife)}@`);
    for (const c of f.children) w.line(1, 'CHIL', `@${indiId.get(c.id)}@`);
    const p = f.partnership;
    if (p) {
      const married = ['marriage', 'customary_marriage', 'civil_union'].includes(p.subtype);
      if (married) {
        w.event(1, 'MARR', p.startDate, undefined, true);
        if (p.subtype !== 'marriage') w.line(2, 'TYPE', p.subtype === 'customary_marriage' ? 'Customary marriage' : 'Civil union');
      } else if (p.subtype === 'engagement') {
        w.event(1, 'ENGA', p.startDate, undefined, true);
      }
      if (p.status === 'divorced') w.event(1, 'DIV', p.endDate, undefined, true);
      if (p.status === 'annulled') w.event(1, 'ANUL', p.endDate, undefined, true);
    }
  }
  w.line(0, 'TRLR');
  return w.lines.join('\r\n') + '\r\n';
}
