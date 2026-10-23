import type { TreeEdge, TreeNode } from '@fh/contracts';
import { DEFAULT_LAYOUT, layoutFamilyTree, type TreeLayout } from './layout';

let edgeSeq = 0;
function person(id: string, extra: Partial<TreeNode> = {}): TreeNode {
  return {
    id,
    displayName: id,
    firstName: id,
    surname: '',
    photoUrl: null,
    birthDate: null,
    deathDate: null,
    vitalStatus: null,
    gender: null,
    hometown: null,
    generation: { number: null, status: 'pending', candidates: [], overridden: false },
    isFounder: false,
    childCount: 0,
    parentCount: 0,
    lineage: { maternal: null, paternal: null },
    ...extra,
  };
}
const child = (from: string, to: string, subtype: TreeEdge['subtype'] = 'biological'): TreeEdge => ({ id: `e${edgeSeq++}`, type: 'parent_child', from, to, subtype, status: null, verification: 'verified' });
const partner = (from: string, to: string): TreeEdge => ({ id: `e${edgeSeq++}`, type: 'partnership', from, to, subtype: 'marriage', status: 'current', verification: 'verified' });

/** Builds nodes with consistent child counts from the edges. */
function graph(ids: string[], edges: TreeEdge[], extra: Record<string, Partial<TreeNode>> = {}) {
  const nodes = ids.map((id) =>
    person(id, { childCount: edges.filter((e) => e.type === 'parent_child' && e.from === id).length, ...extra[id] }),
  );
  return { nodes, edges };
}

const at = (l: TreeLayout, id: string) => l.nodes.find((n) => n.id === id)!;

function assertNoOverlap(l: TreeLayout) {
  const byLevel = new Map<number, number[]>();
  for (const n of l.nodes) byLevel.set(n.level, [...(byLevel.get(n.level) ?? []), n.x]);
  for (const xs of byLevel.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.cardWidth);
  }
}

describe('family tree layout', () => {
  it('puts the root at the top and each generation in its own band', () => {
    const { nodes, edges } = graph(['kofi', 'kwame', 'ama', 'yaw'], [child('kofi', 'kwame'), child('kofi', 'ama'), child('kwame', 'yaw')], {
      kofi: { generation: { number: 1, status: 'founder', candidates: [], overridden: false } },
    });
    const l = layoutFamilyTree('kofi', nodes, edges);
    expect([at(l, 'kofi').level, at(l, 'kwame').level, at(l, 'yaw').level]).toEqual([0, 1, 2]);
    expect(at(l, 'yaw').y).toBeGreaterThan(at(l, 'kwame').y);
    expect(l.bands.map((b) => b.generation)).toEqual([1, 2, 3]);
    assertNoOverlap(l);
  });

  it('centres parents over their children and orders siblings by birth', () => {
    const { nodes, edges } = graph(['p', 'a', 'b', 'c'], [child('p', 'b'), child('p', 'a'), child('p', 'c')], {
      a: { birthDate: { year: 1950, qualifier: 'exact', sortKey: 19500000 } },
      b: { birthDate: { year: 1940, qualifier: 'exact', sortKey: 19400000 } },
      c: { birthDate: { year: 1960, qualifier: 'exact', sortKey: 19600000 } },
    });
    const l = layoutFamilyTree('p', nodes, edges);
    expect([at(l, 'b').x < at(l, 'a').x, at(l, 'a').x < at(l, 'c').x]).toEqual([true, true]);
    const centreKids = (at(l, 'b').x + at(l, 'c').x) / 2;
    expect(at(l, 'p').x).toBeCloseTo(centreKids, 5);
  });

  it('places partners who married in beside their spouse, not as descendants', () => {
    const { nodes, edges } = graph(['kofi', 'akosua', 'kwame'], [partner('kofi', 'akosua'), child('kofi', 'kwame'), child('akosua', 'kwame')]);
    const l = layoutFamilyTree('kofi', nodes, edges);
    expect(at(l, 'akosua')).toMatchObject({ role: 'partner', level: 0 });
    expect(at(l, 'akosua').x).toBe(at(l, 'kofi').x + DEFAULT_LAYOUT.cardWidth + DEFAULT_LAYOUT.partnerGap);
    // One connector from the couple to the child, starting between the two cards.
    const parentLinks = l.links.filter((k) => k.kind === 'parent');
    expect(parentLinks).toHaveLength(1);
    expect(parentLinks[0]!.people).toEqual(['kofi', 'akosua', 'kwame']);
    expect(l.links.filter((k) => k.kind === 'secondary-parent')).toHaveLength(0);
  });

  it('groups children by co-parent in blended families with several partnerships', () => {
    const { nodes, edges } = graph(
      ['kofi', 'ama', 'efua', 'a1', 'a2', 'e1', 'solo'],
      [partner('kofi', 'ama'), partner('kofi', 'efua'), child('kofi', 'a1'), child('ama', 'a1'), child('kofi', 'a2'), child('ama', 'a2'), child('kofi', 'e1'), child('efua', 'e1'), child('kofi', 'solo')],
    );
    const l = layoutFamilyTree('kofi', nodes, edges);
    const groups = l.links.filter((k) => k.kind === 'parent').map((k) => `${k.people.slice(0, -1).join('+')}>${k.people.at(-1)}`);
    expect(groups.sort()).toEqual(['kofi+ama>a1', 'kofi+ama>a2', 'kofi+efua>e1', 'kofi>solo']);
    // Children of the same couple are adjacent.
    const order = ['solo', 'a1', 'a2', 'e1'].sort((a, b) => at(l, a).x - at(l, b).x);
    expect(order).toEqual(['solo', 'a1', 'a2', 'e1']);
    assertNoOverlap(l);
  });

  it('draws a second parent elsewhere in the tree (cousin marriage) without duplicating the child', () => {
    const { nodes, edges } = graph(
      ['root', 'a', 'b', 'a1', 'b1', 'b2', 'kid'],
      [child('root', 'a'), child('root', 'b'), child('a', 'a1'), child('b', 'b1'), child('b1', 'b2'), partner('a1', 'b2'), child('a1', 'kid'), child('b2', 'kid')],
    );
    const l = layoutFamilyTree('root', nodes, edges);
    expect(l.nodes.filter((n) => n.id === 'kid')).toHaveLength(1);
    expect(at(l, 'kid').level).toBe(3); // via a1 (level 2) — the shallowest path places the child
    expect(l.links.filter((k) => k.kind === 'secondary-parent').map((k) => k.people)).toEqual([['b2', 'kid']]);
    // Partners who are both descendants are joined by an arc, not placed side by side.
    const arc = l.links.find((k) => k.kind === 'partner')!;
    expect(arc.d).toContain('C');
    assertNoOverlap(l);
  });

  it('draws adoptive and step links with their own subtype', () => {
    const { nodes, edges } = graph(['p', 'adopted', 'stepParent', 'kid'], [child('p', 'adopted', 'adoptive'), partner('p', 'stepParent'), child('p', 'kid'), child('stepParent', 'kid', 'step')]);
    const l = layoutFamilyTree('p', nodes, edges);
    expect(l.links.find((k) => k.people.at(-1) === 'adopted')!.subtype).toBe('adoptive');
    // kid hangs from the couple because stepParent is also recorded as a parent.
    expect(l.links.find((k) => k.kind === 'parent' && k.people.at(-1) === 'kid')!.people).toEqual(['p', 'stepParent', 'kid']);
  });

  it('collapses a branch and reports children that are not shown', () => {
    const { nodes, edges } = graph(['p', 'c1', 'c2', 'g'], [child('p', 'c1'), child('p', 'c2'), child('c1', 'g')]);
    const full = layoutFamilyTree('p', nodes, edges);
    expect(full.nodes).toHaveLength(4);
    const folded = layoutFamilyTree('p', nodes, edges, new Set(['c1']));
    expect(folded.nodes.map((n) => n.id).sort()).toEqual(['c1', 'c2', 'p']);
    expect(at(folded, 'c1')).toMatchObject({ collapsed: true, hiddenChildren: 1 });
  });

  it('reports children that exist on the server but are not loaded yet', () => {
    const nodes = [person('p', { childCount: 3 }), person('c1')];
    const l = layoutFamilyTree('p', nodes, [child('p', 'c1')]);
    expect(at(l, 'p').hiddenChildren).toBe(2);
  });

  it('ignores people not connected to the root and copes with a missing root', () => {
    const { nodes, edges } = graph(['p', 'c', 'stranger'], [child('p', 'c')]);
    const l = layoutFamilyTree('p', nodes, edges);
    expect(l.unplaced).toEqual(['stranger']);
    expect(layoutFamilyTree(null, nodes, edges).nodes).toEqual([]);
  });

  it('lays out a large family without overlaps', () => {
    const ids = ['r'];
    const edges: TreeEdge[] = [];
    let layer = ['r'];
    for (let g = 0; g < 4; g++) {
      const next: string[] = [];
      for (const p of layer) for (let i = 0; i < 4; i++) {
        const id = `${p}.${i}`;
        ids.push(id);
        edges.push(child(p, id));
        next.push(id);
      }
      layer = next;
    }
    const { nodes } = graph(ids, edges);
    const started = performance.now();
    const l = layoutFamilyTree('r', nodes, edges);
    expect(performance.now() - started).toBeLessThan(500);
    expect(l.nodes).toHaveLength(341);
    assertNoOverlap(l);
  });
});
