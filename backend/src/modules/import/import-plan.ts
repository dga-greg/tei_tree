import type { ImportWarning, ParentChildSubtype, PartnershipStatus, PartnershipSubtype } from '@fh/contracts';
import type { ParsedGedcom, ParsedPerson } from './gedcom-parser.js';

/**
 * Decides what an import will write, applying the family's integrity rules (docs/02-DATA-MODEL.md §2.1)
 * to the file and the family together, in memory. Pure; ids are strings: existing member ids, or
 * `new:<ref>` for people the import creates.
 *
 * Rules applied, each reported as a warning when it changes something:
 * - a link to oneself, or repeated in the file, or already in the family, is skipped;
 * - a third biological parent is recorded as an "unknown" parent link instead;
 * - links that would make someone their own ancestor are skipped;
 * - two people cannot be both parent and child and partners: the partnership is skipped.
 */

export interface ExistingGraph {
  parentLinks: { parent: string; child: string; subtype: string }[];
  partnerships: { a: string; b: string }[];
}

export interface PlannedParentLink {
  parent: string;
  child: string;
  subtype: ParentChildSubtype;
}

export interface PlannedPartnership {
  a: string;
  b: string;
  subtype: PartnershipSubtype;
  status: PartnershipStatus;
  startDate: ParsedGedcom['partnerships'][number]['startDate'];
  endDate: ParsedGedcom['partnerships'][number]['endDate'];
}

export interface ImportPlan {
  /** People to create (not matched to someone already in the family). */
  create: ParsedPerson[];
  /** File ref → member id for matched people. */
  matched: Map<string, string>;
  parentLinks: PlannedParentLink[];
  partnerships: PlannedPartnership[];
  skipped: number;
  warnings: ImportWarning[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildImportPlan(parsed: ParsedGedcom, existing: ExistingGraph, same: Map<string, string>): ImportPlan {
  const warnings: ImportWarning[] = [];
  const names = new Map(parsed.people.map((p) => [p.ref, `${p.firstName} ${p.surname}`.trim()]));
  const idOf = (ref: string) => same.get(ref) ?? `new:${ref}`;
  const label = (id: string) => (id.startsWith('new:') ? (names.get(id.slice(4)) ?? id) : 'a person already in the family');
  let skipped = 0;

  // ---- parent links
  const existingParent = new Set(existing.parentLinks.map((l) => `${l.parent}|${l.child}`));
  const existingPartner = new Set(existing.partnerships.map((p) => pairKey(p.a, p.b)));
  const bioCount = new Map<string, number>();
  for (const l of existing.parentLinks) if (l.subtype === 'biological') bioCount.set(l.child, (bioCount.get(l.child) ?? 0) + 1);

  const planned = new Map<string, PlannedParentLink>();
  for (const l of parsed.parentLinks) {
    const parent = idOf(l.parent);
    const child = idOf(l.child);
    const key = `${parent}|${child}`;
    if (parent === child) {
      warnings.push({ ref: l.child, message: `${label(child)} was listed as their own parent; that link was skipped` });
      skipped++;
      continue;
    }
    if (planned.has(key)) continue;
    if (existingParent.has(key)) {
      skipped++;
      continue;
    }
    planned.set(key, { parent, child, subtype: l.subtype });
  }
  for (const link of planned.values()) {
    if (link.subtype !== 'biological') continue;
    const n = (bioCount.get(link.child) ?? 0) + 1;
    if (n > 2) {
      link.subtype = 'unknown';
      warnings.push({ ref: link.child.startsWith('new:') ? link.child.slice(4) : undefined, message: `${label(link.child)} has more than two birth parents; the extra parent link was recorded as "unknown"` });
    } else {
      bioCount.set(link.child, n);
    }
  }

  // ---- cycles: Kahn's algorithm over existing + planned links; planned links left inside a cycle are dropped.
  let candidates = [...planned.values()];
  for (let round = 0; round < 5; round++) {
    const edges = [...existing.parentLinks.map((l) => ({ parent: l.parent, child: l.child })), ...candidates];
    const indegree = new Map<string, number>();
    const out = new Map<string, string[]>();
    for (const e of edges) {
      indegree.set(e.child, (indegree.get(e.child) ?? 0) + 1);
      if (!indegree.has(e.parent)) indegree.set(e.parent, indegree.get(e.parent) ?? 0);
      out.set(e.parent, [...(out.get(e.parent) ?? []), e.child]);
    }
    const queue = [...indegree].filter(([, d]) => d === 0).map(([n]) => n);
    while (queue.length) {
      const n = queue.pop()!;
      for (const c of out.get(n) ?? []) {
        const d = indegree.get(c)! - 1;
        indegree.set(c, d);
        if (d === 0) queue.push(c);
      }
    }
    const inCycle = new Set([...indegree].filter(([, d]) => d > 0).map(([n]) => n));
    if (!inCycle.size) break;
    const keep = candidates.filter((l) => !(inCycle.has(l.parent) && inCycle.has(l.child)));
    for (const l of candidates) {
      if (inCycle.has(l.parent) && inCycle.has(l.child)) {
        warnings.push({ ref: l.child.startsWith('new:') ? l.child.slice(4) : undefined, message: `Linking ${label(l.parent)} as a parent of ${label(l.child)} would make someone their own ancestor; the link was skipped` });
        skipped++;
      }
    }
    candidates = keep;
  }
  const parentLinks = candidates;
  const parentPairs = new Set([...existing.parentLinks, ...parentLinks].map((l) => pairKey(l.parent, l.child)));

  // ---- partnerships
  const partnerships: PlannedPartnership[] = [];
  const seenPairs = new Set<string>();
  for (const p of parsed.partnerships) {
    const a = idOf(p.a);
    const b = idOf(p.b);
    if (a === b) {
      skipped++;
      continue;
    }
    const key = pairKey(a, b);
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    if (existingPartner.has(key)) {
      skipped++;
      continue;
    }
    if (parentPairs.has(key)) {
      warnings.push({ ref: p.a, message: `${label(a)} and ${label(b)} are recorded as parent and child, so their partnership was skipped` });
      skipped++;
      continue;
    }
    partnerships.push({ a, b, subtype: p.subtype, status: p.status, startDate: p.startDate, endDate: p.endDate });
  }

  return {
    create: parsed.people.filter((p) => !same.has(p.ref)),
    matched: new Map([...same].filter(([ref]) => names.has(ref))),
    parentLinks,
    partnerships,
    skipped,
    warnings,
  };
}
