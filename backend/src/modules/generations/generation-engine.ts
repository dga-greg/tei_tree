/**
 * Generation engine — a pure function, free of I/O, so it can be tested exhaustively.
 * See docs/04-GENERATION-ENGINE.md.
 *
 *   G(founder) = {1}
 *   G(child)   = ⋃ { g + 1 : g ∈ G(parent) } over verified descent edges parent → child
 *                replaced by {override} when the person is in conflict and has a valid override
 *
 * Generation numbers depend only on the graph, never on dates.
 */

import type { GenerationStatus, VitalStatus } from '@fh/contracts';

export interface EnginePerson {
  id: string;
  vitalStatus: VitalStatus;
  birthYear: number | null;
  override: number | null;
}

export interface EngineEdge {
  parent: string;
  child: string;
  subtype: string;
  verification: string;
}

export interface EngineInput {
  founderId: string | null;
  people: EnginePerson[];
  descent: EngineEdge[];
  /** Partnerships as unordered pairs. */
  partnerships: [string, string][];
  countAdoptive: boolean;
}

export interface GenerationResult {
  number: number | null;
  status: GenerationStatus;
  candidates: number[];
  /** True when an administrator's override decided the number. */
  overridden: boolean;
}

export interface GenerationBucket {
  number: number;
  total: number;
  living: number;
  deceased: number;
  unknown: number;
  earliestBirthYear: number | null;
  latestBirthYear: number | null;
}

export interface EngineOutput {
  results: Map<string, GenerationResult>;
  byGeneration: GenerationBucket[];
  totals: { members: number; generations: number; conflicts: number; unconnected: number; marriedIn: number; unverified: number };
  /** People caught in a parent→child cycle (should be impossible; reported, never numbered). */
  cycle: string[];
}

/** Candidate sets stay small in real families; the cap guards against pathological data. */
const MAX_CANDIDATES = 8;

function isDescentSubtype(subtype: string, countAdoptive: boolean): boolean {
  return subtype === 'biological' || (countAdoptive && subtype === 'adoptive');
}

/**
 * Propagates candidate sets from the founder over `edges` in topological order.
 * Returns the candidate sets of every reachable person and any nodes stuck in a cycle.
 */
function propagate(
  founder: string,
  edges: EngineEdge[],
  overrides: Map<string, number>,
  useOverrides: boolean,
): { candidates: Map<string, number[]>; overridden: Map<string, number[]>; cycle: string[] } {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const list = children.get(e.parent);
    if (list) list.push(e.child);
    else children.set(e.parent, [e.child]);
  }

  // 1. Reachable set from the founder.
  const reachable = new Set<string>([founder]);
  const queue = [founder];
  while (queue.length) {
    const p = queue.shift()!;
    for (const c of children.get(p) ?? []) {
      if (!reachable.has(c)) {
        reachable.add(c);
        queue.push(c);
      }
    }
  }

  // 2. Kahn's algorithm restricted to the reachable subgraph.
  const indegree = new Map<string, number>();
  for (const id of reachable) indegree.set(id, 0);
  for (const e of edges) if (reachable.has(e.parent) && reachable.has(e.child)) indegree.set(e.child, indegree.get(e.child)! + 1);

  const candidates = new Map<string, number[]>([[founder, [1]]]);
  /** Overridden people and the candidate numbers the override chose between. */
  const overridden = new Map<string, number[]>();
  const incoming = new Map<string, Set<number>>();
  const order: string[] = [];
  const ready = [...reachable].filter((id) => indegree.get(id) === 0);

  while (ready.length) {
    const p = ready.shift()!;
    order.push(p);
    if (p !== founder) {
      const set = [...(incoming.get(p) ?? [])].sort((a, b) => a - b).slice(0, MAX_CANDIDATES);
      const override = overrides.get(p);
      if (useOverrides && set.length > 1 && override !== undefined && set.includes(override)) {
        candidates.set(p, [override]);
        overridden.set(p, set);
      } else {
        candidates.set(p, set);
      }
    }
    for (const c of children.get(p) ?? []) {
      if (!reachable.has(c)) continue;
      const into = incoming.get(c) ?? new Set<number>();
      for (const g of candidates.get(p) ?? []) into.add(g + 1);
      incoming.set(c, into);
      indegree.set(c, indegree.get(c)! - 1);
      if (indegree.get(c) === 0) ready.push(c);
    }
  }

  const done = new Set(order);
  const cycle = [...reachable].filter((id) => !done.has(id));
  for (const id of cycle) candidates.delete(id);
  return { candidates, overridden, cycle };
}

export function computeGenerations(input: EngineInput): EngineOutput {
  const ids = new Set(input.people.map((p) => p.id));
  const results = new Map<string, GenerationResult>();
  const pending: GenerationResult = { number: null, status: 'pending', candidates: [], overridden: false };

  const founder = input.founderId && ids.has(input.founderId) ? input.founderId : null;
  if (!founder) {
    for (const p of input.people) results.set(p.id, { ...pending });
    return { results, byGeneration: [], totals: { members: input.people.length, generations: 0, conflicts: 0, unconnected: 0, marriedIn: 0, unverified: 0 }, cycle: [] };
  }

  const known = input.descent.filter((e) => ids.has(e.parent) && ids.has(e.child) && isDescentSubtype(e.subtype, input.countAdoptive));
  const verified = known.filter((e) => e.verification === 'verified');
  // Disputed links never place anyone; unverified links only give a provisional number.
  const provisionalEdges = known.filter((e) => e.verification !== 'disputed');
  const overrides = new Map(input.people.filter((p) => p.override != null).map((p) => [p.id, p.override!]));

  const main = propagate(founder, verified, overrides, true);
  const provisional = propagate(founder, provisionalEdges, overrides, false);

  const partnersOf = new Map<string, string[]>();
  for (const [a, b] of input.partnerships) {
    partnersOf.set(a, [...(partnersOf.get(a) ?? []), b]);
    partnersOf.set(b, [...(partnersOf.get(b) ?? []), a]);
  }

  for (const p of input.people) {
    const set = main.candidates.get(p.id);
    if (p.id === founder) {
      results.set(p.id, { number: 1, status: 'founder', candidates: [], overridden: false });
    } else if (set && set.length === 1) {
      const chosenFrom = main.overridden.get(p.id);
      results.set(p.id, { number: set[0]!, status: 'computed', candidates: chosenFrom ?? [], overridden: chosenFrom !== undefined });
    } else if (set && set.length > 1) {
      results.set(p.id, { number: null, status: 'conflict', candidates: set, overridden: false });
    } else if (provisional.candidates.has(p.id)) {
      results.set(p.id, { number: null, status: 'unverified_path', candidates: provisional.candidates.get(p.id)!, overridden: false });
    } else if ((partnersOf.get(p.id) ?? []).some((q) => main.candidates.has(q))) {
      results.set(p.id, { number: null, status: 'married_in', candidates: [], overridden: false });
    } else {
      results.set(p.id, { number: null, status: 'unconnected', candidates: [], overridden: false });
    }
  }
  for (const id of main.cycle) results.set(id, { number: null, status: 'unconnected', candidates: [], overridden: false });

  // Statistics per generation.
  const buckets = new Map<number, GenerationBucket>();
  for (const p of input.people) {
    const r = results.get(p.id)!;
    if (r.number == null) continue;
    const b = buckets.get(r.number) ?? { number: r.number, total: 0, living: 0, deceased: 0, unknown: 0, earliestBirthYear: null, latestBirthYear: null };
    b.total++;
    b[p.vitalStatus]++;
    if (p.birthYear != null) {
      b.earliestBirthYear = b.earliestBirthYear == null ? p.birthYear : Math.min(b.earliestBirthYear, p.birthYear);
      b.latestBirthYear = b.latestBirthYear == null ? p.birthYear : Math.max(b.latestBirthYear, p.birthYear);
    }
    buckets.set(r.number, b);
  }
  const byGeneration = [...buckets.values()].sort((a, b) => a.number - b.number);
  const count = (s: GenerationStatus) => [...results.values()].filter((r) => r.status === s).length;

  return {
    results,
    byGeneration,
    totals: {
      members: input.people.length,
      generations: byGeneration.length ? byGeneration[byGeneration.length - 1]!.number : 0,
      conflicts: count('conflict'),
      unconnected: count('unconnected'),
      marriedIn: count('married_in'),
      unverified: count('unverified_path'),
    },
    cycle: main.cycle,
  };
}
