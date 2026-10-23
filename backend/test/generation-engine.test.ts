import { describe, expect, it } from 'vitest';
import { computeGenerations, type EngineEdge, type EngineInput, type EnginePerson } from '../src/modules/generations/generation-engine.js';

/** Small DSL: people by name, edges as "parent>child" with optional subtype/verification. */
function family(spec: {
  founder?: string | null;
  people: string[];
  edges?: (string | [string, Partial<EngineEdge>])[];
  partners?: [string, string][];
  countAdoptive?: boolean;
  overrides?: Record<string, number>;
  status?: Record<string, EnginePerson['vitalStatus']>;
  born?: Record<string, number>;
}): EngineInput {
  return {
    founderId: spec.founder === undefined ? spec.people[0]! : spec.founder,
    people: spec.people.map((id) => ({
      id,
      vitalStatus: spec.status?.[id] ?? 'unknown',
      birthYear: spec.born?.[id] ?? null,
      override: spec.overrides?.[id] ?? null,
    })),
    descent: (spec.edges ?? []).map((e) => {
      const [pair, extra] = typeof e === 'string' ? [e, {}] : e;
      const [parent, child] = pair.split('>');
      return { parent: parent!, child: child!, subtype: 'biological', verification: 'verified', ...extra };
    }),
    partnerships: spec.partners ?? [],
    countAdoptive: spec.countAdoptive ?? true,
  };
}

function gen(input: EngineInput) {
  const out = computeGenerations(input);
  const view = (id: string) => {
    const r = out.results.get(id)!;
    return r.status === 'conflict' || r.status === 'unverified_path' ? `${r.status}:${r.candidates.join('/')}` : r.number != null ? r.number : r.status;
  };
  return { out, view };
}

describe('generation engine', () => {
  it('numbers the founder 1 and each direct descendant one more than their parent', () => {
    const { view, out } = gen(family({ people: ['kofi', 'kwame', 'ama', 'yaw', 'esi'], edges: ['kofi>kwame', 'kofi>ama', 'kwame>yaw', 'yaw>esi'] }));
    expect(['kofi', 'kwame', 'ama', 'yaw', 'esi'].map(view)).toEqual([1, 2, 2, 3, 4]);
    expect(out.results.get('kofi')!.status).toBe('founder');
    expect(out.totals.generations).toBe(4);
  });

  it('continues indefinitely', () => {
    const people = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const edges = people.slice(1).map((p, i) => `p${i}>${p}`);
    const { view } = gen(family({ people, edges }));
    expect(view('p59')).toBe(60);
  });

  it('does not give spouses who married in a descendant generation', () => {
    const { view, out } = gen(family({ people: ['kofi', 'akosua', 'kwame', 'adwoa'], edges: ['kofi>kwame', 'akosua>kwame'], partners: [['kofi', 'akosua'], ['kwame', 'adwoa']] }));
    expect(view('kwame')).toBe(2);
    expect(view('akosua')).toBe('married_in');
    expect(view('adwoa')).toBe('married_in');
    expect(out.totals.marriedIn).toBe(2);
  });

  it('marks people with no recorded connection as unconnected', () => {
    const { view } = gen(family({ people: ['kofi', 'stranger', 'stranger_child'], edges: ['stranger>stranger_child'] }));
    expect(view('stranger')).toBe('unconnected');
    expect(view('stranger_child')).toBe('unconnected');
  });

  it('supports unknown ancestry above the founder without numbering it', () => {
    // An ancestor recorded above the founder is not numbered until an administrator makes them the founder.
    const { view } = gen(family({ founder: 'kofi', people: ['kofi', 'father', 'kwame'], edges: ['father>kofi', 'kofi>kwame'] }));
    expect(view('kofi')).toBe(1);
    expect(view('kwame')).toBe(2);
    expect(view('father')).toBe('unconnected');
  });

  it('only counts verified links; unverified ones give a provisional number; disputed ones nothing', () => {
    const { view, out } = gen(
      family({
        people: ['kofi', 'kwame', 'yaw', 'esi'],
        edges: ['kofi>kwame', ['kwame>yaw', { verification: 'unverified' }], ['kwame>esi', { verification: 'disputed' }]],
      }),
    );
    expect(view('kwame')).toBe(2);
    expect(view('yaw')).toBe('unverified_path:3');
    expect(view('esi')).toBe('unconnected');
    expect(out.totals.unverified).toBe(1);
  });

  it('counts adoption as descent by default and not when the family turns it off', () => {
    const input = family({ people: ['kofi', 'adjoa', 'kojo'], edges: [['kofi>adjoa', { subtype: 'adoptive' }], 'adjoa>kojo'] });
    expect(gen(input).view('kojo')).toBe(3);
    const off = gen({ ...input, countAdoptive: false });
    expect(off.view('adjoa')).toBe('unconnected');
    expect(off.view('kojo')).toBe('unconnected');
  });

  it('never treats step, foster or guardian links as descent', () => {
    const { view } = gen(
      family({
        people: ['kofi', 'step', 'foster', 'ward'],
        edges: [['kofi>step', { subtype: 'step' }], ['kofi>foster', { subtype: 'foster' }], ['kofi>ward', { subtype: 'guardian' }]],
      }),
    );
    expect(['step', 'foster', 'ward'].map(view)).toEqual(['unconnected', 'unconnected', 'unconnected']);
  });

  it('flags conflicting paths (cousin marriage across generations) instead of choosing', () => {
    // kofi → kwame → yaw ; kofi → ama → abena → kojo ; yaw + kojo → child (3+1 vs 4+1)
    const input = family({
      people: ['kofi', 'kwame', 'yaw', 'ama', 'abena', 'kojo', 'child', 'grandchild'],
      edges: ['kofi>kwame', 'kwame>yaw', 'kofi>ama', 'ama>abena', 'abena>kojo', 'yaw>child', 'kojo>child', 'child>grandchild'],
    });
    const { view, out } = gen(input);
    expect(view('child')).toBe('conflict:4/5');
    // The conflict propagates to descendants rather than being silently resolved.
    expect(view('grandchild')).toBe('conflict:5/6');
    expect(out.totals.conflicts).toBe(2);
    expect(out.byGeneration.map((b) => b.number)).toEqual([1, 2, 3, 4]);
  });

  it('applies an administrator override that resolves a conflict, and recomputes below it', () => {
    const base = {
      people: ['kofi', 'kwame', 'yaw', 'ama', 'abena', 'kojo', 'child', 'grandchild'],
      edges: ['kofi>kwame', 'kwame>yaw', 'kofi>ama', 'ama>abena', 'abena>kojo', 'yaw>child', 'kojo>child', 'child>grandchild'],
    };
    const { view, out } = gen(family({ ...base, overrides: { child: 4 } }));
    expect(view('child')).toBe(4);
    expect(out.results.get('child')!.overridden).toBe(true);
    expect(view('grandchild')).toBe(5);
    // An override that is not one of the candidates (e.g. stale after the tree changed) is ignored.
    expect(gen(family({ ...base, overrides: { child: 9 } })).view('child')).toBe('conflict:4/5');
    // An override on someone without a conflict has no effect.
    expect(gen(family({ ...base, overrides: { kwame: 7 } })).view('kwame')).toBe(2);
  });

  it('agrees when two paths give the same number (e.g. both parents descend at the same depth)', () => {
    const { view } = gen(family({ people: ['kofi', 'a', 'b', 'c'], edges: ['kofi>a', 'kofi>b', 'a>c', 'b>c'] }));
    expect(view('c')).toBe(3);
  });

  it('keeps generation independent of birth year', () => {
    const { view } = gen(family({ people: ['kofi', 'late', 'early'], edges: ['kofi>late', 'late>early'], born: { kofi: 1890, late: 1980, early: 1920 } }));
    expect(view('early')).toBe(3);
  });

  it('recalculates relative to a new founder', () => {
    const spec = { people: ['elder', 'kofi', 'kwame'], edges: ['elder>kofi', 'kofi>kwame'] };
    expect(gen(family({ ...spec, founder: 'kofi' })).view('kwame')).toBe(2);
    expect(gen(family({ ...spec, founder: 'elder' })).view('kwame')).toBe(3);
  });

  it('leaves everyone pending when there is no founder', () => {
    const { view, out } = gen(family({ founder: null, people: ['a', 'b'], edges: ['a>b'] }));
    expect(view('a')).toBe('pending');
    expect(out.totals.generations).toBe(0);
  });

  it('defends against cycles in corrupted data without looping', () => {
    const { out, view } = gen(family({ people: ['kofi', 'a', 'b'], edges: ['kofi>a', 'a>b', 'b>a'] }));
    expect(out.cycle.sort()).toEqual(['a', 'b']);
    expect(view('a')).toBe('unconnected');
  });

  it('produces per-generation statistics', () => {
    const { out } = gen(
      family({
        people: ['kofi', 'a', 'b', 'c'],
        edges: ['kofi>a', 'kofi>b', 'a>c'],
        status: { kofi: 'deceased', a: 'deceased', b: 'living', c: 'living' },
        born: { kofi: 1890, a: 1921, b: 1935 },
      }),
    );
    expect(out.byGeneration).toEqual([
      { number: 1, total: 1, living: 0, deceased: 1, unknown: 0, earliestBirthYear: 1890, latestBirthYear: 1890 },
      { number: 2, total: 2, living: 1, deceased: 1, unknown: 0, earliestBirthYear: 1921, latestBirthYear: 1935 },
      { number: 3, total: 1, living: 1, deceased: 0, unknown: 0, earliestBirthYear: null, latestBirthYear: null },
    ]);
  });

  it('handles a large family quickly', () => {
    // 5 children per person over 7 generations ≈ 19 531 people.
    const people = ['root'];
    const edges: string[] = [];
    let layer = ['root'];
    for (let g = 2; g <= 7; g++) {
      const next: string[] = [];
      for (const p of layer) for (let i = 0; i < 5; i++) {
        const id = `${p}.${i}`;
        people.push(id);
        edges.push(`${p}>${id}`);
        next.push(id);
      }
      layer = next;
    }
    const started = performance.now();
    const { out } = gen(family({ people, edges }));
    expect(performance.now() - started).toBeLessThan(2000);
    expect(out.totals.generations).toBe(7);
    expect(out.byGeneration.at(-1)!.total).toBe(5 ** 6);
  });
});
