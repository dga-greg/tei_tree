/**
 * Kinship engine — a pure function over the family graph (no I/O). See docs/04-GENERATION-ENGINE.md §4.3.
 *
 * 1. Blood: find the closest common ancestors of A and B over birth and adoptive links, measure the
 *    generations from each side, and name the relationship (parent, sibling, aunt/uncle, cousins with
 *    degree and removal, half-relations…).
 * 2. Otherwise, relationships through one partnership: spouses, in-laws, step-relations.
 * 3. Otherwise: not related by the recorded links. The engine never guesses.
 *
 * Disputed links are ignored. Unverified links are used but lower the confidence.
 */

import type { Gender, KinshipKind, KinshipStep, VerificationState } from '@fh/contracts';

export interface KinPerson {
  id: string;
  name: string;
  gender: Gender | null;
}

export interface KinEdge {
  parent: string;
  child: string;
  subtype: string;
  verification: string;
}

export interface KinPartnership {
  a: string;
  b: string;
  subtype: string;
  status: string | null;
  verification: string;
}

export interface KinshipOutcome {
  kind: KinshipKind;
  term: string | null;
  reciprocal: string | null;
  summary: string;
  explanation: string[];
  blood: { fromA: number; fromB: number; cousinDegree: number | null; removed: number | null; half: boolean | null } | null;
  commonAncestors: string[];
  pathPeople: string[];
  steps: KinshipStep[];
  confidence: 'verified' | 'includes_unverified';
  viaAdoption: boolean;
  alsoPartners: boolean;
}

const BLOOD = new Set(['biological', 'adoptive']);
const OTHER_PARENT = new Set(['step', 'foster', 'guardian', 'unknown']);
const ENDED = new Set(['divorced', 'separated', 'annulled']);

// ---------------------------------------------------------------- words

const gendered = (g: Gender | null, male: string, female: string, neutral: string) => (g === 'male' ? male : g === 'female' ? female : neutral);

/** "", "great-", "great-great-", "3× great-" … */
function greats(n: number): string {
  if (n <= 0) return '';
  if (n === 1) return 'great-';
  if (n === 2) return 'great-great-';
  return `${n}× great-`;
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinal = (n: number) => ORDINALS[n] ?? `${n}th`;
const REMOVED = ['', 'once', 'twice', 'three times', 'four times', 'five times'];
const removedWord = (n: number) => REMOVED[n] ?? `${n} times`;

/**
 * What a person is to another, from the generations each is below their closest common ancestor.
 * `up` = generations from the subject to the ancestor, `down` = from the other person.
 */
export function bloodTerm(up: number, down: number, g: Gender | null, half: boolean | null = null): string {
  const h = half ? 'half-' : '';
  if (up === 0 && down === 0) return 'self';
  if (up === 0) {
    if (down === 1) return gendered(g, 'father', 'mother', 'parent');
    return greats(down - 2) + gendered(g, 'grandfather', 'grandmother', 'grandparent');
  }
  if (down === 0) {
    if (up === 1) return gendered(g, 'son', 'daughter', 'child');
    return greats(up - 2) + gendered(g, 'grandson', 'granddaughter', 'grandchild');
  }
  if (up === 1 && down === 1) return h + gendered(g, 'brother', 'sister', 'sibling');
  if (up === 1) {
    // Sibling of the other person's ancestor: uncle (2), great-uncle (3), great-great-uncle (4)…
    if (down === 2) return h + gendered(g, 'uncle', 'aunt', "parent's sibling");
    return h + gendered(g, `${greats(down - 2)}uncle`, `${greats(down - 2)}aunt`, `${greats(down - 3)}grandparent's sibling`);
  }
  if (down === 1) {
    // Descendant of the other person's sibling: nephew (2), grandnephew (3), great-grandnephew (4)…
    if (up === 2) return h + gendered(g, 'nephew', 'niece', "sibling's child");
    return h + gendered(g, `${greats(up - 3)}grandnephew`, `${greats(up - 3)}grandniece`, `sibling's ${greats(up - 3)}grandchild`);
  }
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  return `${h}${ordinal(degree)} cousin${removed ? ` ${removedWord(removed)} removed` : ''}`;
}

const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

// ---------------------------------------------------------------- graph

interface Ancestry {
  /** ancestor id → generations up, and the edge from the ancestor to the next person towards the origin. */
  dist: Map<string, number>;
  next: Map<string, { toward: string; edge: KinEdge }>;
}

export class KinshipGraph {
  private readonly parents = new Map<string, KinEdge[]>();
  private readonly otherParents = new Map<string, KinEdge[]>();
  private readonly partners = new Map<string, KinPartnership[]>();
  private readonly ancestryCache = new Map<string, Ancestry>();

  constructor(
    readonly people: Map<string, KinPerson>,
    edges: KinEdge[],
    partnerships: KinPartnership[],
  ) {
    for (const e of edges) {
      if (e.verification === 'disputed' || !people.has(e.parent) || !people.has(e.child)) continue;
      const map = BLOOD.has(e.subtype) ? this.parents : OTHER_PARENT.has(e.subtype) ? this.otherParents : null;
      map?.set(e.child, [...(map.get(e.child) ?? []), e]);
    }
    for (const p of partnerships) {
      if (p.verification === 'disputed' || !people.has(p.a) || !people.has(p.b)) continue;
      this.partners.set(p.a, [...(this.partners.get(p.a) ?? []), p]);
      this.partners.set(p.b, [...(this.partners.get(p.b) ?? []), p]);
    }
  }

  parentEdges(id: string): KinEdge[] {
    return this.parents.get(id) ?? [];
  }

  partnershipsOf(id: string): KinPartnership[] {
    return this.partners.get(id) ?? [];
  }

  nonBloodParentEdge(parent: string, child: string): KinEdge | undefined {
    return (this.otherParents.get(child) ?? []).find((e) => e.parent === parent);
  }

  /** The person (distance 0) and all ancestors by birth or adoption, closest path first. */
  ancestry(id: string): Ancestry {
    const cached = this.ancestryCache.get(id);
    if (cached) return cached;
    const dist = new Map([[id, 0]]);
    const next = new Map<string, { toward: string; edge: KinEdge }>();
    const queue = [id];
    while (queue.length) {
      const c = queue.shift()!;
      // Prefer verified links when two paths are equally short.
      const edges = [...this.parentEdges(c)].sort((x, y) => Number(x.verification !== 'verified') - Number(y.verification !== 'verified'));
      for (const e of edges) {
        if (dist.has(e.parent)) continue;
        dist.set(e.parent, dist.get(c)! + 1);
        next.set(e.parent, { toward: c, edge: e });
        queue.push(e.parent);
      }
    }
    const result = { dist, next };
    this.ancestryCache.set(id, result);
    return result;
  }
}

interface BloodLink {
  up: number;
  down: number;
  lcas: string[];
  /** From A up to the ancestor, then down to B. */
  people: string[];
  edges: KinEdge[];
  half: boolean | null;
}

function chainUp(anc: Ancestry, from: string, to: string): { people: string[]; edges: KinEdge[] } {
  // Walk from the ancestor back towards the origin, then reverse.
  const people = [to];
  const edges: KinEdge[] = [];
  let cur = to;
  while (cur !== from) {
    const step = anc.next.get(cur)!;
    edges.push(step.edge);
    cur = step.toward;
    people.push(cur);
  }
  return { people: people.reverse(), edges: edges.reverse() };
}

function bloodLink(g: KinshipGraph, a: string, b: string): BloodLink | null {
  const ancA = g.ancestry(a);
  const ancB = g.ancestry(b);
  let best: { id: string; up: number; down: number } | null = null;
  const common: { id: string; up: number; down: number }[] = [];
  for (const [id, up] of ancA.dist) {
    const down = ancB.dist.get(id);
    if (down === undefined) continue;
    common.push({ id, up, down });
    if (!best || up + down < best.up + best.down || (up + down === best.up + best.down && up < best.up)) best = { id, up, down };
  }
  if (!best) return null;
  const lcas = common.filter((c) => c.up === best!.up && c.down === best!.down).map((c) => c.id);
  const toA = chainUp(ancA, a, best.id); // a … ancestor
  const toB = chainUp(ancB, b, best.id); // b … ancestor
  const people = [...toA.people, ...toB.people.slice(0, -1).reverse()];
  const edges = [...toA.edges, ...[...toB.edges].reverse()];

  // Full or half: compare the parents of the two people just below the common ancestor.
  let half: boolean | null = null;
  if (best.up >= 1 && best.down >= 1) {
    const x = toA.people[toA.people.length - 2]!;
    const y = toB.people[toB.people.length - 2]!;
    const px = new Set(g.parentEdges(x).filter((e) => e.subtype === 'biological').map((e) => e.parent));
    const py = new Set(g.parentEdges(y).filter((e) => e.subtype === 'biological').map((e) => e.parent));
    const shared = [...px].filter((p) => py.has(p)).length;
    if (shared >= 2) half = false;
    else if (shared === 1 && px.size >= 2 && py.size >= 2) half = true;
    else half = null; // a parent is missing from the record: cannot tell
  }
  return { up: best.up, down: best.down, lcas, people, edges, half };
}

// ---------------------------------------------------------------- result helpers

function stepsFor(g: KinshipGraph, people: string[], edges: (KinEdge | KinPartnership)[]): KinshipStep[] {
  const steps: KinshipStep[] = [];
  for (let i = 0; i < edges.length; i++) {
    const from = people[i]!;
    const to = people[i + 1]!;
    const e = edges[i]!;
    const gender = g.people.get(to)?.gender ?? null;
    if ('parent' in e) {
      const up = e.child === from;
      const base = up ? gendered(gender, 'father', 'mother', 'parent') : gendered(gender, 'son', 'daughter', 'child');
      const prefix = e.subtype === 'adoptive' ? 'adoptive ' : e.subtype === 'biological' ? '' : `${e.subtype} `;
      steps.push({ from, to, relation: up ? 'parent' : 'child', label: prefix + base, subtype: e.subtype, verification: e.verification as VerificationState });
    } else {
      const word = e.subtype === 'marriage' || e.subtype === 'customary_marriage' ? gendered(gender, 'husband', 'wife', 'spouse') : 'partner';
      const label = e.status && ENDED.has(e.status) ? `former ${word}` : word;
      steps.push({ from, to, relation: 'partner', label, subtype: e.subtype, verification: e.verification as VerificationState });
    }
  }
  return steps;
}

function confidenceOf(edges: { verification: string }[]): 'verified' | 'includes_unverified' {
  return edges.every((e) => e.verification === 'verified') ? 'verified' : 'includes_unverified';
}

// ---------------------------------------------------------------- main

export function findKinship(g: KinshipGraph, a: string, b: string): KinshipOutcome {
  const A = g.people.get(a)!;
  const B = g.people.get(b)!;
  const base: Pick<KinshipOutcome, 'blood' | 'commonAncestors' | 'viaAdoption' | 'alsoPartners'> = { blood: null, commonAncestors: [], viaAdoption: false, alsoPartners: false };

  if (a === b) {
    return { ...base, kind: 'self', term: null, reciprocal: null, summary: `${A.name} is the same person.`, explanation: [], pathPeople: [a], steps: [], confidence: 'verified' };
  }

  const directPartnership = g.partnershipsOf(a).find((p) => p.a === b || p.b === b);
  const blood = bloodLink(g, a, b);

  if (blood) {
    const term = bloodTerm(blood.up, blood.down, A.gender, blood.half);
    const reciprocal = bloodTerm(blood.down, blood.up, B.gender, blood.half);
    const viaAdoption = blood.edges.some((e) => e.subtype === 'adoptive');
    const isCousin = blood.up >= 2 && blood.down >= 2;
    const lcaNames = blood.lcas.map((id) => g.people.get(id)!.name);
    const explanation: string[] = [];
    if (blood.up === 0 || blood.down === 0) {
      const [older, younger, gens] = blood.up === 0 ? [A, B, blood.down] : [B, A, blood.up];
      explanation.push(`${older.name} is ${gens} generation${gens > 1 ? 's' : ''} above ${younger.name} in a direct line.`);
    } else {
      explanation.push(`Their closest common ancestor${blood.lcas.length > 1 ? 's are' : ' is'} ${lcaNames.join(' and ')}.`);
      explanation.push(`${A.name} is ${blood.up} generation${blood.up > 1 ? 's' : ''} below ${blood.lcas.length > 1 ? 'them' : lcaNames[0]}; ${B.name} is ${blood.down}.`);
      if (isCousin) {
        const degree = Math.min(blood.up, blood.down) - 1;
        const removed = Math.abs(blood.up - blood.down);
        explanation.push(
          `The shorter line has ${Math.min(blood.up, blood.down)} generations, which makes them ${ordinal(degree)} cousins` +
            (removed ? `; the lines differ by ${removed} generation${removed > 1 ? 's' : ''}, so they are ${removedWord(removed)} removed.` : '.'),
        );
      }
      if (blood.half === true) explanation.push('The two lines meet at only one shared parent, so this is a half-relationship.');
      if (blood.half === null) explanation.push('One of the parents on the two lines is not recorded, so it is not known whether this is a full or half relationship.');
    }
    if (viaAdoption) explanation.push('The connection includes an adoption.');
    const confidence = confidenceOf(blood.edges);
    if (confidence !== 'verified') explanation.push('Some links on this path are not yet verified.');
    if (directPartnership) explanation.push(`${A.name} and ${B.name} are also recorded as partners.`);
    const degree = isCousin ? Math.min(blood.up, blood.down) - 1 : null;
    return {
      kind: 'blood',
      term: viaAdoption && (blood.up === 0 || blood.down === 0) && blood.up + blood.down === 1 ? `adoptive ${term}` : term,
      reciprocal: viaAdoption && blood.up + blood.down === 1 ? `adoptive ${reciprocal}` : reciprocal,
      summary: `${A.name} is ${possessive(B.name)} ${viaAdoption && blood.up + blood.down === 1 ? 'adoptive ' : ''}${term}.`,
      explanation,
      blood: { fromA: blood.up, fromB: blood.down, cousinDegree: degree, removed: isCousin ? Math.abs(blood.up - blood.down) : null, half: blood.half },
      commonAncestors: blood.lcas,
      pathPeople: blood.people,
      steps: stepsFor(g, blood.people, blood.edges),
      confidence,
      viaAdoption,
      alsoPartners: !!directPartnership,
    };
  }

  if (directPartnership) {
    const marriage = directPartnership.subtype === 'marriage' || directPartnership.subtype === 'customary_marriage';
    const ended = directPartnership.status && ENDED.has(directPartnership.status) ? 'former ' : '';
    const term = ended + (marriage ? gendered(A.gender, 'husband', 'wife', 'spouse') : 'partner');
    const reciprocal = ended + (marriage ? gendered(B.gender, 'husband', 'wife', 'spouse') : 'partner');
    return {
      ...base,
      kind: 'partner',
      term,
      reciprocal,
      summary: `${A.name} is ${possessive(B.name)} ${term}.`,
      explanation: [`They are recorded as ${marriage ? 'married' : 'partners'}${directPartnership.status && directPartnership.status !== 'current' ? ` (${directPartnership.status})` : ''}.`],
      pathPeople: [a, b],
      steps: stepsFor(g, [a, b], [directPartnership]),
      confidence: confidenceOf([directPartnership]),
    };
  }

  // A step, foster or guardian parent recorded directly.
  const direct = g.nonBloodParentEdge(a, b) ?? g.nonBloodParentEdge(b, a);
  if (direct) {
    const aIsParent = direct.parent === a;
    const kindWord = direct.subtype === 'unknown' ? '' : `${direct.subtype}-`;
    const pTerm = `${kindWord}${gendered((aIsParent ? A : B).gender, 'father', 'mother', 'parent')}`;
    const cTerm = `${kindWord}${gendered((aIsParent ? B : A).gender, 'son', 'daughter', 'child')}`;
    const term = aIsParent ? pTerm : cTerm;
    const reciprocal = aIsParent ? cTerm : pTerm;
    return {
      ...base,
      kind: 'step',
      term: term.replace(/^-/, ''),
      reciprocal: reciprocal.replace(/^-/, ''),
      summary: `${A.name} is ${possessive(B.name)} ${term}.`,
      explanation: [direct.subtype === 'unknown' ? 'A parent–child link of unrecorded type connects them.' : `They are linked as ${direct.subtype} parent and child.`],
      pathPeople: [a, b],
      steps: stepsFor(g, [a, b], [direct]),
      confidence: confidenceOf([direct]),
    };
  }

  // Through exactly one partnership: A … X ═ Y … B, shortest first.
  const affinal = throughMarriage(g, a, b);
  if (affinal) return affinal;

  return {
    ...base,
    kind: 'not_found',
    term: null,
    reciprocal: null,
    summary: `No relationship between ${A.name} and ${B.name} can be traced from the recorded links.`,
    explanation: [
      'No chain of recorded parent–child links (and at most one marriage or partnership) connects them.',
      'Adding missing parents or verifying links may reveal a connection.',
    ],
    pathPeople: [],
    steps: [],
    confidence: 'verified',
  };
}

function throughMarriage(g: KinshipGraph, a: string, b: string): KinshipOutcome | null {
  const A = g.people.get(a)!;
  const B = g.people.get(b)!;
  let best: { x: string; y: string; p: KinPartnership; ax: BloodLink | null; yb: BloodLink | null; length: number } | null = null;

  const candidates = new Set<KinPartnership>();
  for (const people of g.people.keys()) for (const p of g.partnershipsOf(people)) candidates.add(p);
  for (const p of candidates) {
    for (const [x, y] of [
      [p.a, p.b],
      [p.b, p.a],
    ] as const) {
      const ax = x === a ? null : bloodLink(g, a, x);
      if (x !== a && !ax) continue;
      const yb = y === b ? null : bloodLink(g, y, b);
      if (y !== b && !yb) continue;
      const length = (ax ? ax.up + ax.down : 0) + 1 + (yb ? yb.up + yb.down : 0);
      if (!best || length < best.length) best = { x, y, p, ax, yb, length };
    }
  }
  if (!best) return null;

  const { x, y, p, ax, yb } = best;
  const X = g.people.get(x)!;
  const Y = g.people.get(y)!;
  const spouseWord = (who: KinPerson) =>
    p.subtype === 'marriage' || p.subtype === 'customary_marriage' ? gendered(who.gender, 'husband', 'wife', 'spouse') : 'partner';

  let term: string;
  let reciprocal: string;
  let kind: KinshipKind = 'marriage';
  if (!ax && yb) {
    // A is the partner of Y, and Y is B's relative.
    const yToB = bloodTerm(yb.up, yb.down, null);
    if (yb.up === 0 && yb.down === 1) {
      kind = 'step';
      term = `step${gendered(A.gender, 'father', 'mother', 'parent')}`;
      reciprocal = `step${gendered(B.gender, 'son', 'daughter', 'child')}`;
    } else if (yb.up === 0 && yb.down >= 2) {
      kind = 'step';
      term = `step-${bloodTerm(0, yb.down, A.gender)}`;
      reciprocal = `step-${bloodTerm(yb.down, 0, B.gender)}`;
    } else if (yb.up === 1 && yb.down === 1) {
      term = `${gendered(A.gender, 'brother', 'sister', 'sibling')}-in-law`;
      reciprocal = `${gendered(B.gender, 'brother', 'sister', 'sibling')}-in-law`;
    } else if (yb.up === 1 && yb.down === 0) {
      term = `${gendered(A.gender, 'son', 'daughter', 'child')}-in-law`;
      reciprocal = `${gendered(B.gender, 'father', 'mother', 'parent')}-in-law`;
    } else if (yb.up === 1 && yb.down === 2) {
      term = `${gendered(A.gender, 'uncle', 'aunt', "parent's sibling")} by marriage`;
      reciprocal = `${gendered(B.gender, 'nephew', 'niece', "sibling's child")} by marriage`;
    } else {
      term = `${spouseWord(A)} of ${possessive(B.name)} ${yToB}`;
      reciprocal = `${bloodTerm(yb.down, yb.up, null)} of ${possessive(A.name)} ${spouseWord(Y)}`;
    }
  } else if (ax && !yb) {
    // B is the partner of X, and A is X's relative.
    const aToX = bloodTerm(ax.up, ax.down, A.gender);
    if (ax.up === 0 && ax.down === 1) {
      term = `${gendered(A.gender, 'father', 'mother', 'parent')}-in-law`;
      reciprocal = `${gendered(B.gender, 'son', 'daughter', 'child')}-in-law`;
    } else if (ax.up === 1 && ax.down === 1) {
      term = `${gendered(A.gender, 'brother', 'sister', 'sibling')}-in-law`;
      reciprocal = `${gendered(B.gender, 'brother', 'sister', 'sibling')}-in-law`;
    } else if (ax.up === 1 && ax.down === 0) {
      kind = 'step';
      term = `step${gendered(A.gender, 'son', 'daughter', 'child')}`;
      reciprocal = `step${gendered(B.gender, 'father', 'mother', 'parent')}`;
    } else if (ax.down === 0) {
      kind = 'step';
      term = `step-${bloodTerm(ax.up, 0, A.gender)}`;
      reciprocal = `step-${bloodTerm(0, ax.up, B.gender)}`;
    } else if (ax.up === 0 && ax.down === 2) {
      term = `${gendered(A.gender, 'grandfather', 'grandmother', 'grandparent')}-in-law`;
      reciprocal = `${gendered(B.gender, 'grandson', 'granddaughter', 'grandchild')}-in-law`;
    } else if (ax.up === 2 && ax.down === 1) {
      term = `${gendered(A.gender, 'nephew', 'niece', "sibling's child")} by marriage`;
      reciprocal = `${gendered(B.gender, 'uncle', 'aunt', "parent's sibling")} by marriage`;
    } else {
      term = `${aToX} of ${possessive(B.name)} ${spouseWord(X)}`;
      reciprocal = `${spouseWord(B)} of ${possessive(A.name)} ${bloodTerm(ax.down, ax.up, null)}`;
    }
  } else if (ax && yb) {
    if (ax.up === 1 && ax.down === 0 && yb.up === 0 && yb.down === 1) {
      kind = 'step';
      term = `step${gendered(A.gender, 'brother', 'sister', 'sibling')}`;
      reciprocal = `step${gendered(B.gender, 'brother', 'sister', 'sibling')}`;
    } else {
      const xRel = bloodTerm(ax.down, ax.up, null); // what X is to A
      const yRel = bloodTerm(yb.up, yb.down, null); // what Y is to B
      term = `connected by marriage: ${possessive(A.name)} ${xRel} is the ${spouseWord(X)} of ${possessive(B.name)} ${yRel}`;
      reciprocal = term;
    }
  } else {
    return null; // direct partnership is handled earlier
  }

  const people = [...(ax ? ax.people : [a]), ...(yb ? yb.people : [b])];
  const edges: (KinEdge | KinPartnership)[] = [...(ax?.edges ?? []), p, ...(yb?.edges ?? [])];
  const confidence = confidenceOf(edges);
  const explanation = [
    `${X.name} and ${Y.name} are recorded as ${p.subtype === 'marriage' || p.subtype === 'customary_marriage' ? 'married' : 'partners'}${p.status && p.status !== 'current' ? ` (${p.status})` : ''}.`,
    `${A.name} and ${B.name} are not related by blood; they are connected through this ${p.subtype === 'partnership' ? 'partnership' : 'marriage'}.`,
  ];
  if (confidence !== 'verified') explanation.push('Some links on this path are not yet verified.');
  const summary = term.startsWith('connected by marriage')
    ? `${A.name} and ${B.name} are ${term.replace('connected by marriage: ', 'connected by marriage — ')}.`
    : `${A.name} is ${possessive(B.name)} ${term}.`;
  return {
    kind,
    term: term.startsWith('connected by marriage') ? 'related by marriage' : term,
    reciprocal: reciprocal.startsWith('connected by marriage') ? 'related by marriage' : reciprocal,
    summary,
    explanation,
    blood: null,
    commonAncestors: [],
    pathPeople: people,
    steps: stepsFor(g, people, edges),
    confidence,
    viaAdoption: edges.some((e) => 'parent' in e && e.subtype === 'adoptive'),
    alsoPartners: false,
  };
}

