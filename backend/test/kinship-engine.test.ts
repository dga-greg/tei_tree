import { describe, expect, it } from 'vitest';
import type { Gender } from '@fh/contracts';
import { KinshipGraph, findKinship, type KinEdge, type KinPartnership, type KinPerson } from '../src/modules/kinship/kinship-engine.js';

/*
 * Test family (m = male, f = female, ? = gender not recorded)
 *
 *   GGF(m) ══ GGM(f)
 *     ├─ GF(m) ══ GM(f)                         GF ══ GM2(f) ─ HALFUNCLE(m) ─ HALFCOUSIN(m)
 *     │   ├─ F(m) ══(divorced)══ M(f) ══ STEPDAD(m) ─ STEPBRO(m)
 *     │   │    │                  └─ (with MEX) HALFSIS(f)
 *     │   │    ├─ ME(m) ══ WIFE(f)  ── SON(m) ══ SON_W(f) ─ GRANDSON(m) ─ GGSON(m) ─ GGGSON(m)
 *     │   │    │                    ── DAUGHTER(f)
 *     │   │    │    ME ─(adoptive)─ ADOPTED(f)      FOSTER(f) ─(foster)─ ME
 *     │   │    ├─ SIS(f) ══ SIS_H(m) ─ NEPHEW(m) ─ GRANDNIECE(f)
 *     │   │    │    SIS ─ NEUTRAL(?)    SIS ─(unverified)─ UNV(m)
 *     │   │    └─ ONLY(m)  (only F recorded as parent)       F ─(disputed)─ DISP
 *     │   └─ AUNT(f) ══ AUNT_H(m) ─ COUSIN(f) ─ COUSIN_CHILD(m)
 *     └─ GU(m) ─ GU_CHILD(m) ─ GU_GC(f)
 *   WIFE_F(m) ─ WIFE, WIFE_BRO(m)        STRANGER(m)
 *   COUSIN ══ HALFCOUSIN (cousin marriage)
 */
const genders: Record<string, Gender | null> = {
  GGF: 'male', GGM: 'female', GF: 'male', GM: 'female', GM2: 'female', GU: 'male', F: 'male', M: 'female', MEX: 'male', STEPDAD: 'male', STEPBRO: 'male',
  AUNT: 'female', AUNT_H: 'male', HALFUNCLE: 'male', ME: 'male', WIFE: 'female', SIS: 'female', SIS_H: 'male', HALFSIS: 'female', ONLY: 'male', DISP: 'male',
  SON: 'male', SON_W: 'female', DAUGHTER: 'female', GRANDSON: 'male', GGSON: 'male', GGGSON: 'male', ADOPTED: 'female', FOSTER: 'female',
  NEPHEW: 'male', GRANDNIECE: 'female', NEUTRAL: null, UNV: 'male', COUSIN: 'female', COUSIN_CHILD: 'male', HALFCOUSIN: 'male',
  GU_CHILD: 'male', GU_GC: 'female', WIFE_F: 'male', WIFE_BRO: 'male', STRANGER: 'male',
};
const people = new Map<string, KinPerson>(Object.entries(genders).map(([id, gender]) => [id, { id, name: id, gender }]));

const e = (parent: string, child: string, subtype = 'biological', verification = 'verified'): KinEdge => ({ parent, child, subtype, verification });
const edges: KinEdge[] = [
  e('GGF', 'GF'), e('GGM', 'GF'), e('GGF', 'GU'), e('GGM', 'GU'),
  e('GF', 'F'), e('GM', 'F'), e('GF', 'AUNT'), e('GM', 'AUNT'), e('GF', 'HALFUNCLE'), e('GM2', 'HALFUNCLE'),
  e('F', 'ME'), e('M', 'ME'), e('F', 'SIS'), e('M', 'SIS'), e('M', 'HALFSIS'), e('MEX', 'HALFSIS'), e('F', 'ONLY'),
  e('F', 'DISP', 'biological', 'disputed'), e('STEPDAD', 'STEPBRO'),
  e('ME', 'SON'), e('WIFE', 'SON'), e('ME', 'DAUGHTER'), e('WIFE', 'DAUGHTER'), e('ME', 'ADOPTED', 'adoptive'), e('FOSTER', 'ME', 'foster'),
  e('SON', 'GRANDSON'), e('SON_W', 'GRANDSON'), e('GRANDSON', 'GGSON'), e('GGSON', 'GGGSON'),
  e('SIS', 'NEPHEW'), e('SIS_H', 'NEPHEW'), e('NEPHEW', 'GRANDNIECE'), e('SIS', 'NEUTRAL'), e('SIS', 'UNV', 'biological', 'unverified'),
  e('AUNT', 'COUSIN'), e('AUNT_H', 'COUSIN'), e('COUSIN', 'COUSIN_CHILD'), e('HALFUNCLE', 'HALFCOUSIN'),
  e('GU', 'GU_CHILD'), e('GU_CHILD', 'GU_GC'), e('WIFE_F', 'WIFE'), e('WIFE_F', 'WIFE_BRO'),
];
const p = (a: string, b: string, subtype = 'marriage', status: string | null = 'current'): KinPartnership => ({ a, b, subtype, status, verification: 'verified' });
const partnerships: KinPartnership[] = [
  p('GGF', 'GGM'), p('GF', 'GM'), p('GF', 'GM2'), p('F', 'M', 'marriage', 'divorced'), p('M', 'STEPDAD'), p('ME', 'WIFE'), p('SON', 'SON_W'),
  p('SIS', 'SIS_H'), p('AUNT', 'AUNT_H'), p('COUSIN', 'HALFCOUSIN', 'partnership'),
];
const graph = new KinshipGraph(people, edges, partnerships);
const kin = (a: string, b: string) => findKinship(graph, a, b);

describe('kinship terms (what A is to B)', () => {
  const cases: [string, string, string][] = [
    // direct line
    ['ME', 'F', 'son'],
    ['F', 'ME', 'father'],
    ['ME', 'M', 'son'],
    ['ME', 'GF', 'grandson'],
    ['GF', 'ME', 'grandfather'],
    ['ME', 'GGF', 'great-grandson'],
    ['GGF', 'ME', 'great-grandfather'],
    ['GGF', 'SON', 'great-great-grandfather'],
    ['GGF', 'GRANDSON', '3× great-grandfather'],
    ['GGGSON', 'ME', 'great-great-grandson'],
    ['GM', 'DAUGHTER', 'great-grandmother'],
    // siblings
    ['ME', 'SIS', 'brother'],
    ['SIS', 'ME', 'sister'],
    ['ME', 'HALFSIS', 'half-brother'],
    ['HALFSIS', 'ME', 'half-sister'],
    ['SON', 'DAUGHTER', 'brother'],
    // aunts, uncles, nephews, nieces
    ['ME', 'AUNT', 'nephew'],
    ['AUNT', 'ME', 'aunt'],
    ['GU', 'ME', 'great-uncle'],
    ['ME', 'GU', 'grandnephew'],
    ['HALFUNCLE', 'ME', 'half-uncle'],
    ['ME', 'HALFUNCLE', 'half-nephew'],
    ['ME', 'NEPHEW', 'uncle'],
    ['NEPHEW', 'ME', 'nephew'],
    ['GRANDNIECE', 'ME', 'grandniece'],
    ['ME', 'GRANDNIECE', 'great-uncle'],
    ['GU', 'SON', 'great-great-uncle'],
    ['SON', 'GU', 'great-grandnephew'],
    // cousins
    ['ME', 'COUSIN', 'first cousin'],
    ['ME', 'COUSIN_CHILD', 'first cousin once removed'],
    ['COUSIN_CHILD', 'ME', 'first cousin once removed'],
    ['ME', 'GU_CHILD', 'first cousin once removed'],
    ['ME', 'GU_GC', 'second cousin'],
    ['SON', 'GU_GC', 'second cousin once removed'],
    ['GRANDSON', 'GU_CHILD', 'first cousin three times removed'],
    ['ME', 'HALFCOUSIN', 'half-first cousin'],
    // gender not recorded: neutral words
    ['NEUTRAL', 'ME', "sibling's child"],
    ['ME', 'NEUTRAL', 'uncle'],
    // adoption
    ['ME', 'ADOPTED', 'adoptive father'],
    ['ADOPTED', 'ME', 'adoptive daughter'],
    ['ADOPTED', 'SON', 'sister'],
    // partners
    ['ME', 'WIFE', 'husband'],
    ['WIFE', 'ME', 'wife'],
    ['F', 'M', 'former husband'],
    // step, foster
    ['STEPDAD', 'ME', 'stepfather'],
    ['ME', 'STEPDAD', 'stepson'],
    ['ME', 'STEPBRO', 'stepbrother'],
    ['STEPDAD', 'SON', 'step-grandfather'],
    ['FOSTER', 'ME', 'foster-mother'],
    ['ME', 'FOSTER', 'foster-son'],
    // in-laws
    ['WIFE_F', 'ME', 'father-in-law'],
    ['ME', 'WIFE_F', 'son-in-law'],
    ['ME', 'WIFE_BRO', 'brother-in-law'],
    ['WIFE_BRO', 'ME', 'brother-in-law'],
    ['SIS_H', 'ME', 'brother-in-law'],
    ['WIFE', 'SIS', 'sister-in-law'],
    ['SON_W', 'ME', 'daughter-in-law'],
    ['ME', 'SON_W', 'father-in-law'],
    ['GF', 'WIFE', 'grandfather-in-law'],
    ['AUNT_H', 'ME', 'uncle by marriage'],
    ['ME', 'AUNT_H', 'nephew by marriage'],
    ['NEPHEW', 'WIFE', 'nephew by marriage'],
    ['WIFE', 'NEPHEW', 'aunt by marriage'],
  ];

  it.each(cases)('%s is %s’s %s', (a, b, term) => {
    expect(kin(a, b).term).toBe(term);
  });

  it('covers at least 60 cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });
});

describe('kinship details', () => {
  it('returns the reciprocal term and a one-sentence summary', () => {
    const r = kin('GU', 'ME');
    expect(r).toMatchObject({ kind: 'blood', term: 'great-uncle', reciprocal: 'grandnephew', summary: "GU is ME's great-uncle." });
  });

  it('names the closest common ancestors and counts generations on each side', () => {
    const r = kin('ME', 'COUSIN');
    expect(r.commonAncestors.sort()).toEqual(['GF', 'GM']);
    expect(r.blood).toEqual({ fromA: 2, fromB: 2, cousinDegree: 1, removed: 0, half: false });
    expect(r.explanation.join(' ')).toMatch(/first cousins/);
  });

  it('explains cousin degree and removal', () => {
    const r = kin('SON', 'GU_GC');
    expect(r.blood).toMatchObject({ fromA: 4, fromB: 3, cousinDegree: 2, removed: 1 });
    expect(r.explanation.join(' ')).toMatch(/second cousins; the lines differ by 1 generation, so they are once removed/);
  });

  it('shows the actual chain of people with labels', () => {
    const r = kin('ME', 'GU');
    expect(r.pathPeople).toEqual(['ME', 'F', 'GF', 'GGF', 'GU']);
    expect(r.steps.map((s) => s.label)).toEqual(['father', 'father', 'father', 'son']);
  });

  it('builds an in-law path through exactly one partnership', () => {
    const r = kin('WIFE_BRO', 'ME');
    expect(r.kind).toBe('marriage');
    expect(r.pathPeople).toEqual(['WIFE_BRO', 'WIFE_F', 'WIFE', 'ME']);
    expect(r.steps.map((s) => s.label)).toEqual(['father', 'daughter', 'husband']);
  });

  it('does not invent full siblinghood when a parent is missing', () => {
    const r = kin('ME', 'ONLY');
    expect(r.term).toBe('brother');
    expect(r.blood!.half).toBeNull();
    expect(r.explanation.join(' ')).toMatch(/not known whether this is a full or half/);
  });

  it('marks paths through unverified links and ignores disputed ones', () => {
    const r = kin('UNV', 'ME');
    expect(r).toMatchObject({ term: 'nephew', confidence: 'includes_unverified' });
    expect(kin('ME', 'SIS').confidence).toBe('verified');
    expect(kin('ME', 'DISP').kind).toBe('not_found');
  });

  it('reports adoption on the path', () => {
    expect(kin('ADOPTED', 'SON').viaAdoption).toBe(true);
    expect(kin('ME', 'SON').viaAdoption).toBe(false);
  });

  it('notes blood relatives who are also partners', () => {
    const r = kin('COUSIN', 'HALFCOUSIN');
    expect(r).toMatchObject({ kind: 'blood', term: 'half-first cousin', alsoPartners: true });
    expect(r.explanation.join(' ')).toMatch(/also recorded as partners/);
  });

  it('describes distant connections through one marriage in plain words', () => {
    const r = kin('COUSIN_CHILD', 'WIFE');
    expect(r.kind).toBe('marriage');
    expect(r.term).toBe("first cousin once removed of WIFE's husband");
    expect(r.steps.filter((s) => s.relation === 'partner')).toHaveLength(1);
  });

  it('does not chain several marriages together', () => {
    // STEPBRO ─ STEPDAD ══ M ─ SIS ══ SIS_H needs two partnerships: not a recognised relationship.
    expect(kin('STEPBRO', 'SIS_H').kind).toBe('not_found');
  });

  it('says plainly when no relationship can be traced', () => {
    const r = kin('ME', 'STRANGER');
    expect(r).toMatchObject({ kind: 'not_found', term: null, pathPeople: [] });
    expect(r.summary).toMatch(/No relationship/);
  });

  it('handles the same person', () => {
    expect(kin('ME', 'ME').kind).toBe('self');
  });

  it('answers quickly on a large family', () => {
    const big = new Map<string, KinPerson>();
    const bigEdges: KinEdge[] = [];
    let layer = ['r'];
    big.set('r', { id: 'r', name: 'r', gender: null });
    for (let g = 0; g < 7; g++) {
      const next: string[] = [];
      for (const parent of layer) for (let i = 0; i < 4; i++) {
        const id = `${parent}.${i}`;
        big.set(id, { id, name: id, gender: null });
        bigEdges.push(e(parent, id));
        next.push(id);
      }
      layer = next;
    }
    const g = new KinshipGraph(big, bigEdges, []);
    const started = performance.now();
    const r = findKinship(g, 'r.0.0.0.0.0.0.0', 'r.3.3.3.3.3.3.3');
    expect(performance.now() - started).toBeLessThan(1000);
    expect(r.term).toBe('sixth cousin');
  });
});
