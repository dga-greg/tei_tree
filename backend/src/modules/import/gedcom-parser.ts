import type { FuzzyDate, Gender, ImportWarning, PartnershipStatus, PartnershipSubtype, ParentChildSubtype, VitalStatus } from '@fh/contracts';
import { fuzzyDateSortKey } from '@fh/contracts';
import { decodeGedcom } from './gedcom-decode.js';

/**
 * GEDCOM reader (5.5, 5.5.1 and 7.0, lineage-linked). Pure: bytes in, plain records out, so it can be
 * tested without a database and run twice (preview, then import) with identical results.
 *
 * Mapping (the reverse of export/gedcom.ts):
 * - INDI → person: NAME/GIVN/SURN/NPFX/NICK, other NAMEs (birth/maiden → maiden name, others → previous
 *   names), SEX, BIRT (or CHR/BAPM), DEAT (or BURI/CREM), OCCU, EDUC, TITL, NATI, NOTE, SOUR.
 * - FAM → a partnership between HUSB and WIFE (MARR → marriage, its TYPE may say customary or civil;
 *   ENGA → engagement; DIV/ANUL/separation → status) and parent links to every CHIL. The kind of
 *   parent link comes from the child's FAMC.PEDI, or the _FREL/_MREL tags some programs write.
 */

export interface ParsedSource {
  title: string;
  citation?: string;
}

export interface ParsedTimelineEntry {
  title: string;
  from?: FuzzyDate | null;
}

export interface ParsedPerson {
  ref: string;
  firstName: string;
  middleNames: string;
  surname: string;
  maidenName: string;
  preferredName: string;
  title: string;
  previousNames: string[];
  gender: Gender | null;
  vitalStatus: VitalStatus;
  birthDate: FuzzyDate | null;
  birthPlace: string;
  deathDate: FuzzyDate | null;
  deathPlace: string;
  nationality: string;
  occupations: ParsedTimelineEntry[];
  education: ParsedTimelineEntry[];
  biography: string;
  sources: ParsedSource[];
}

export interface ParsedParentLink {
  parent: string;
  child: string;
  subtype: ParentChildSubtype;
}

export interface ParsedPartnership {
  a: string;
  b: string;
  subtype: PartnershipSubtype;
  status: PartnershipStatus;
  startDate: FuzzyDate | null;
  endDate: FuzzyDate | null;
}

export interface ParsedGedcom {
  source: { system: string; version: string; charset: string };
  people: ParsedPerson[];
  families: number;
  parentLinks: ParsedParentLink[];
  partnerships: ParsedPartnership[];
  warnings: ImportWarning[];
}

interface Node {
  level: number;
  xref: string | null;
  tag: string;
  value: string;
  children: Node[];
  line: number;
}

const LIMITS = { firstName: 100, middleNames: 200, surname: 100, title: 60, preferredName: 100, place: 200, nationality: 100, biography: 50_000, entry: 200 };
const MAX_WARNINGS = 2000;
const LINE = /^\s*(\d{1,2})\s+(?:(@[^@\s][^@]*@)\s+)?([A-Za-z0-9_]{1,31})(?:\s(.*))?$/;

class Warnings {
  readonly list: ImportWarning[] = [];
  add(message: string, ref?: string): void {
    if (this.list.length < MAX_WARNINGS) this.list.push(ref ? { ref, message } : { message });
  }
}

/** Builds the record tree, joining CONT/CONC continuation lines into their parent's value. */
function parseLines(text: string, warnings: Warnings): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  let bad = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.replace(/^﻿/, '');
    if (!raw.trim()) continue;
    const m = LINE.exec(raw);
    if (!m) {
      // Some programs wrap long values onto a new line without CONC: treat it as a continuation.
      const last = stack[stack.length - 1];
      if (last && !/^\s*\d/.test(raw)) {
        last.value += raw;
        continue;
      }
      if (++bad <= 20) warnings.add(`Line ${i + 1} could not be read and was skipped`);
      continue;
    }
    const level = Number(m[1]);
    const node: Node = { level, xref: m[2] ? m[2].slice(1, -1) : null, tag: m[3]!.toUpperCase(), value: m[4] ?? '', children: [], line: i + 1 };
    while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    if (level === 0 || !parent) {
      if (level !== 0) {
        if (++bad <= 20) warnings.add(`Line ${i + 1} is not inside a record and was skipped`);
        continue;
      }
      roots.push(node);
    } else if (node.tag === 'CONT') {
      parent.value += `\n${node.value}`;
      continue;
    } else if (node.tag === 'CONC') {
      parent.value += node.value;
      continue;
    } else {
      parent.children.push(node);
    }
    stack.push(node);
  }
  if (bad > 20) warnings.add(`${bad - 20} more unreadable lines were skipped`);
  return roots;
}

const child = (n: Node | undefined, tag: string) => n?.children.find((c) => c.tag === tag);
const children = (n: Node | undefined, tag: string) => n?.children.filter((c) => c.tag === tag) ?? [];
const pointer = (value: string) => (/^@([^@]+)@$/.exec(value.trim())?.[1] ?? null);
/** GEDCOM escapes '@' as '@@' in values. */
const unescape = (value: string) => value.replace(/@@/g, '@');
const cut = (value: string, max: number) => (value.length > max ? value.slice(0, max).trimEnd() : value);
const squash = (value: string) => unescape(value).replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ dates

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7, AUGUST: 8, SEPT: 9, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface SimpleDate {
  year: number;
  month?: number;
  day?: number;
}

function parseSimpleDate(input: string): SimpleDate | null {
  const s = input.trim().replace(/\s+/g, ' ');
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
  const parts = iso ? null : s.split(' ');
  let year: number;
  let month: number | undefined;
  let day: number | undefined;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = iso[3] ? Number(iso[3]) : undefined;
  } else {
    if (!parts?.length || parts.length > 3) return null;
    // Dual years ("1750/51") record the old-style year change: the later year is the modern one.
    const yearPart = parts[parts.length - 1]!;
    const y = /^(\d{1,4})(?:\/(\d{1,2}))?$/.exec(yearPart);
    if (!y) return null;
    year = Number(y[1]);
    if (y[2]) year += 1;
    if (parts.length >= 2) {
      month = MONTHS[parts[parts.length - 2]!.replace(/\.$/, '')];
      if (!month) return null;
    }
    if (parts.length === 3) {
      day = Number(parts[0]);
      if (!Number.isInteger(day)) return null;
    }
  }
  if (!Number.isInteger(year) || year < 1 || year > new Date().getUTCFullYear() + 1) return null;
  if (month !== undefined && (month < 1 || month > 12)) return null;
  if (day !== undefined && (!month || day < 1 || day > DAYS_IN_MONTH[month - 1]!)) day = undefined;
  return { year, ...(month ? { month } : {}), ...(day ? { day } : {}) };
}

function fuzzy(d: SimpleDate, qualifier: FuzzyDate['qualifier'], extra: Partial<FuzzyDate> = {}): FuzzyDate {
  const date: FuzzyDate = { ...d, qualifier, ...extra };
  return { ...date, sortKey: fuzzyDateSortKey(date) };
}

/** GEDCOM date value → fuzzy date. Anything that cannot be read is kept as the date's wording. */
export function parseGedcomDate(raw: string | undefined): FuzzyDate | null {
  if (!raw?.trim()) return null;
  const original = cut(squash(raw), 200);
  let s = original.toUpperCase();
  const calendar = /@#D([A-Z ]+)@/.exec(s)?.[1]?.trim();
  if (calendar && calendar !== 'GREGORIAN' && calendar !== 'JULIAN') return { qualifier: 'exact', text: original, sortKey: null };
  s = s.replace(/@#D[A-Z ]+@/g, '').replace(/\b(GREGORIAN|JULIAN)\b/g, '').trim();
  const asText = (): FuzzyDate => ({ qualifier: 'exact', text: original.replace(/^\((.*)\)$/, '$1'), sortKey: null });
  if (!s) return null;
  if (/^\(.*\)$/.test(s)) return asText();
  // Interpreted dates: "INT 1890 (from the family bible)".
  s = s.replace(/^INT\s+/, '').replace(/\s*\(.*\)\s*$/, '').trim();
  if (/\bB\.?C\.?\b|\bBCE\b/.test(s)) return asText();

  let m = /^(?:BET|BETWEEN)\s+(.+?)\s+AND\s+(.+)$/.exec(s) ?? /^FROM\s+(.+?)\s+TO\s+(.+)$/.exec(s);
  if (m) {
    const a = parseSimpleDate(m[1]!);
    const b = parseSimpleDate(m[2]!);
    if (a && b && b.year >= a.year) return a.year === b.year && a.month === b.month && a.day === b.day ? fuzzy(a, 'exact') : fuzzy(a, 'between', { endYear: b.year });
    if (a && b) return fuzzy(b, 'between', { endYear: a.year });
    return asText();
  }
  m = /^(ABT|ABOUT|CIRCA|CA\.?|C\.|CAL|EST|BEF|BEFORE|AFT|AFTER|FROM|TO)\s+(.+)$/.exec(s);
  if (m) {
    const d = parseSimpleDate(m[2]!);
    if (!d) return asText();
    const q: Record<string, FuzzyDate['qualifier']> = { ABT: 'about', ABOUT: 'about', CIRCA: 'about', CA: 'about', 'CA.': 'about', 'C.': 'about', CAL: 'estimated', EST: 'estimated', BEF: 'before', BEFORE: 'before', TO: 'before', AFT: 'after', AFTER: 'after', FROM: 'after' };
    return fuzzy(d, q[m[1]!]!);
  }
  const d = parseSimpleDate(s);
  return d ? fuzzy(d, 'exact') : asText();
}

/** A baptism or burial date stands in for a missing birth or death date: it is close, not exact. */
function approximate(date: FuzzyDate | null): FuzzyDate | null {
  if (!date?.year || date.qualifier !== 'exact') return date;
  return { ...date, qualifier: 'about' };
}

// ------------------------------------------------------------------ people

function splitName(value: string): { given: string; surname: string; suffix: string } {
  const v = squash(value);
  const m = /^([^/]*)\/([^/]*)\/?(.*)$/.exec(v);
  if (!m) return { given: v, surname: '', suffix: '' };
  return { given: m[1]!.trim(), surname: m[2]!.trim(), suffix: m[3]!.trim() };
}

const SEX: Record<string, Gender> = { M: 'male', F: 'female', X: 'other', N: 'other' };

function noteText(n: Node, notes: Map<string, Node>): string {
  const ref = pointer(n.value);
  const text = ref ? (notes.get(ref)?.value ?? '') : n.value;
  return unescape(text).trim();
}

function event(n: Node | undefined): { date: FuzzyDate | null; place: string; present: boolean } {
  if (!n) return { date: null, place: '', present: false };
  return { date: parseGedcomDate(child(n, 'DATE')?.value), place: cut(squash(child(n, 'PLAC')?.value ?? ''), LIMITS.place), present: true };
}

function readPerson(n: Node, notes: Map<string, Node>, sources: Map<string, Node>, warnings: Warnings, currentYear: number): ParsedPerson {
  const ref = n.xref!;
  const names = children(n, 'NAME');
  const typeOf = (name: Node) => (child(name, 'TYPE')?.value ?? '').trim().toLowerCase();
  const primary = names.find((x) => !['married', 'aka', 'nickname', 'immigrant'].includes(typeOf(x))) ?? names[0];
  const parsed = primary ? splitName(primary.value) : { given: '', surname: '', suffix: '' };
  const givn = primary ? squash(child(primary, 'GIVN')?.value ?? '') : '';
  const given = parsed.given || givn;
  const words = given.split(' ').filter(Boolean);
  let firstName = words[0] ?? '';
  if (!firstName || /^[?_.-]+$/.test(firstName)) {
    firstName = 'Unknown';
    warnings.add('Has no first name; recorded as "Unknown"', ref);
  }
  const surnamePrefix = primary ? squash(child(primary, 'SPFX')?.value ?? '') : '';
  let surname = parsed.surname || (primary ? squash(child(primary, 'SURN')?.value ?? '') : '');
  if (surnamePrefix && !surname.toLowerCase().startsWith(surnamePrefix.toLowerCase())) surname = `${surnamePrefix} ${surname}`.trim();
  if (/^[?_.-]+$/.test(surname)) surname = '';

  let maidenName = '';
  const previousNames: string[] = [];
  for (const other of names) {
    if (other === primary) continue;
    const o = splitName(other.value);
    const full = [o.given, o.surname].filter(Boolean).join(' ');
    if (['birth', 'maiden'].includes(typeOf(other)) && o.surname && o.surname !== surname) maidenName = o.surname;
    else if (full) previousNames.push(cut(full, 200));
  }
  for (const marnm of children(n, '_MARNM')) if (squash(marnm.value)) previousNames.push(cut(`${firstName} ${squash(marnm.value)}`, 200));

  const title = cut(squash((primary && child(primary, 'NPFX')?.value) || child(n, 'TITL')?.value || ''), LIMITS.title);
  const preferredName = cut(squash((primary && child(primary, 'NICK')?.value) || child(n, 'NICK')?.value || ''), LIMITS.preferredName);

  const birt = event(child(n, 'BIRT'));
  const chr = event(child(n, 'CHR') ?? child(n, 'BAPM'));
  const deat = event(child(n, 'DEAT'));
  const buri = event(child(n, 'BURI') ?? child(n, 'CREM'));
  const birthDate = birt.date ?? approximate(chr.date);
  const birthPlace = birt.place || chr.place;
  let deathDate = deat.date ?? approximate(buri.date);
  let deathPlace = deat.place || buri.place;

  // Life status: a death or burial means deceased; otherwise people born in the last 100 years are
  // treated as living (so the family's privacy rules protect them), and people born long ago as deceased.
  let vitalStatus: VitalStatus = 'unknown';
  if (deat.present || buri.present) vitalStatus = 'deceased';
  else if (birthDate?.year) vitalStatus = birthDate.year > currentYear - 100 ? 'living' : birthDate.year < currentYear - 120 ? 'deceased' : 'unknown';
  else if (/^living$/i.test(firstName)) vitalStatus = 'living';
  if (vitalStatus === 'living') {
    deathDate = null;
    deathPlace = '';
  }

  const occupations = children(n, 'OCCU')
    .map((o) => ({ title: cut(squash(o.value), LIMITS.entry), from: parseGedcomDate(child(o, 'DATE')?.value) }))
    .filter((o) => o.title)
    .slice(0, 50);
  const education = children(n, 'EDUC')
    .map((e) => ({ title: cut(squash(e.value || child(e, 'TYPE')?.value || child(e, 'PLAC')?.value || ''), LIMITS.entry), from: parseGedcomDate(child(e, 'DATE')?.value) }))
    .filter((e) => e.title)
    .slice(0, 50);

  let biography = children(n, 'NOTE').map((x) => noteText(x, notes)).filter(Boolean).join('\n\n');
  if (biography.length > LIMITS.biography) {
    biography = biography.slice(0, LIMITS.biography);
    warnings.add('Notes were longer than a life story can be and were shortened', ref);
  }

  const sourceList: ParsedSource[] = [];
  for (const s of children(n, 'SOUR').slice(0, 20)) {
    const target = pointer(s.value);
    const record = target ? sources.get(target) : undefined;
    const title = cut(squash(record ? child(record, 'TITL')?.value || child(record, 'ABBR')?.value || '' : s.value), 300) || 'Source';
    const page = cut(squash(child(s, 'PAGE')?.value ?? ''), 2000);
    sourceList.push(page ? { title, citation: page } : { title });
  }

  const sexValue = (child(n, 'SEX')?.value ?? '').trim().toUpperCase().charAt(0);
  return {
    ref,
    firstName: cut(firstName, LIMITS.firstName),
    middleNames: cut(words.slice(1).join(' '), LIMITS.middleNames),
    surname: cut(surname, LIMITS.surname),
    maidenName: cut(maidenName, LIMITS.surname),
    preferredName,
    title,
    previousNames: [...new Set(previousNames)].slice(0, 20),
    gender: SEX[sexValue] ?? null,
    vitalStatus,
    birthDate,
    birthPlace,
    deathDate,
    deathPlace,
    nationality: cut(squash(child(n, 'NATI')?.value ?? ''), LIMITS.nationality),
    occupations,
    education,
    biography,
    sources: sourceList,
  };
}

// ------------------------------------------------------------------ families

const PEDI: Record<string, ParentChildSubtype> = {
  BIRTH: 'biological', NATURAL: 'biological', BIOLOGICAL: 'biological', ADOPTED: 'adoptive', ADOPTIVE: 'adoptive',
  FOSTER: 'foster', STEP: 'step', STEPCHILD: 'step', GUARDIAN: 'guardian', SEALING: 'unknown', UNKNOWN: 'unknown', PRIVATE: 'unknown',
};

function pediOf(value: string | undefined): ParentChildSubtype | null {
  const key = (value ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  return key ? (PEDI[key] ?? null) : null;
}

/** Link kind recorded on the child's FAMC for this family (with the export's note for step and guardian links). */
function famcSubtype(childNode: Node | undefined, famRef: string): ParentChildSubtype | null {
  const famc = children(childNode, 'FAMC').find((f) => pointer(f.value) === famRef);
  if (!famc) return null;
  const note = (child(famc, 'NOTE')?.value ?? '').toLowerCase();
  if (note.includes('step-parent')) return 'step';
  if (note.includes('guardian')) return 'guardian';
  return pediOf(child(famc, 'PEDI')?.value);
}

function marriageSubtype(marr: Node | undefined, fam: Node): PartnershipSubtype {
  if (marr) {
    const type = `${child(marr, 'TYPE')?.value ?? ''} ${marr.value}`.toLowerCase();
    if (/custom|tradition/.test(type)) return 'customary_marriage';
    if (/civil union|registered partner/.test(type)) return 'civil_union';
    if (/partner|common.?law|cohabit|unmarried/.test(type)) return 'partnership';
    return 'marriage';
  }
  if (child(fam, 'ENGA')) return 'engagement';
  const relationship = (child(fam, '_STAT')?.value ?? child(fam, 'TYPE')?.value ?? '').toLowerCase();
  if (/partner|common.?law|unmarried/.test(relationship)) return 'partnership';
  if (/married/.test(relationship)) return 'marriage';
  return 'unknown';
}

export function parseGedcom(bytes: Uint8Array): ParsedGedcom {
  const warnings = new Warnings();
  const { text, charset } = decodeGedcom(bytes);
  const roots = parseLines(text, warnings);
  const head = roots.find((r) => r.tag === 'HEAD');
  if (!head) warnings.add('The file has no header; it may not be a GEDCOM file');
  const sour = child(head, 'SOUR');
  const source = {
    system: cut(squash(child(sour, 'NAME')?.value || sour?.value || ''), 120),
    version: cut(squash(child(child(head, 'GEDC'), 'VERS')?.value ?? ''), 20),
    charset,
  };

  const notes = new Map<string, Node>();
  const sources = new Map<string, Node>();
  const indis: Node[] = [];
  const fams: Node[] = [];
  const seen = new Set<string>();
  for (const r of roots) {
    if (r.xref) {
      if (seen.has(r.xref) && (r.tag === 'INDI' || r.tag === 'FAM')) {
        warnings.add(`The id ${r.xref} is used twice; the second record was skipped`, r.xref);
        continue;
      }
      seen.add(r.xref);
    }
    if (r.tag === 'NOTE' && r.xref) notes.set(r.xref, r);
    else if (r.tag === 'SOUR' && r.xref) sources.set(r.xref, r);
    else if (r.tag === 'INDI' && r.xref) indis.push(r);
    else if (r.tag === 'FAM' && r.xref) fams.push(r);
  }

  const currentYear = new Date().getUTCFullYear();
  const people = indis.map((n) => readPerson(n, notes, sources, warnings, currentYear));
  const byRef = new Map(indis.map((n) => [n.xref!, n]));

  const parentLinks: ParsedParentLink[] = [];
  const partnerships: ParsedPartnership[] = [];
  // Some programs only write the child's FAMC, not the family's CHIL: treat those as children too.
  const listed = new Set(fams.flatMap((f) => children(f, 'CHIL').map((c) => `${f.xref}|${pointer(c.value)}`)));
  const famRefs = new Set(fams.map((f) => f.xref!));
  const extraChildren = new Map<string, string[]>();
  for (const indi of indis) {
    for (const famc of children(indi, 'FAMC')) {
      const famRef = pointer(famc.value);
      if (!famRef || !famRefs.has(famRef) || listed.has(`${famRef}|${indi.xref}`)) continue;
      listed.add(`${famRef}|${indi.xref}`);
      extraChildren.set(famRef, [...(extraChildren.get(famRef) ?? []), indi.xref!]);
    }
  }
  for (const fam of fams) {
    const ref = fam.xref!;
    const spouses = [...children(fam, 'HUSB'), ...children(fam, 'WIFE')]
      .map((s) => pointer(s.value))
      .filter((p): p is string => !!p);
    const parents = [...new Set(spouses)].filter((p) => {
      if (byRef.has(p)) return true;
      warnings.add(`Family ${ref} names a parent (${p}) who is not in the file`, ref);
      return false;
    });
    if (parents.length === 2) {
      const marr = child(fam, 'MARR');
      const div = child(fam, 'DIV');
      const anul = child(fam, 'ANUL');
      const separated = child(fam, '_SEPR') ?? children(fam, 'EVEN').find((e) => /separat/i.test(child(e, 'TYPE')?.value ?? ''));
      const status: PartnershipStatus = anul ? 'annulled' : div ? 'divorced' : separated ? 'separated' : 'current';
      partnerships.push({
        a: parents[0]!,
        b: parents[1]!,
        subtype: marriageSubtype(marr, fam),
        status,
        startDate: parseGedcomDate(child(marr ?? child(fam, 'ENGA'), 'DATE')?.value),
        endDate: parseGedcomDate(child(anul ?? div ?? separated, 'DATE')?.value),
      });
    }
    const husband = pointer(child(fam, 'HUSB')?.value ?? '');
    const childNodes = [...children(fam, 'CHIL'), ...(extraChildren.get(ref) ?? []).map((x): Node => ({ level: 1, xref: null, tag: 'CHIL', value: `@${x}@`, children: [], line: 0 }))];
    for (const chil of childNodes) {
      const kid = pointer(chil.value);
      if (!kid || !byRef.has(kid)) {
        warnings.add(`Family ${ref} lists a child (${kid ?? chil.value}) who is not in the file`, ref);
        continue;
      }
      const common = famcSubtype(byRef.get(kid), ref);
      for (const parent of parents) {
        const own = pediOf(child(chil, parent === husband ? '_FREL' : '_MREL')?.value);
        parentLinks.push({ parent, child: kid, subtype: own ?? common ?? 'biological' });
      }
    }
  }
  return { source, people, families: fams.length, parentLinks, partnerships, warnings: warnings.list };
}
