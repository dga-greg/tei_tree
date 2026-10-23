import type { TreeEdge, TreeNode } from '@fh/contracts';

/**
 * Family-tree layout as a pure function (no DOM), so it can be unit-tested.
 *
 * Genealogy is not a binary tree. The layout is built from **family units**: a descendant of the
 * root plus the partners who married in, drawn side by side, with their children hanging below the
 * couple they belong to. Each generation occupies its own horizontal band.
 *
 * - Every descendant is placed once, under its *primary* parent (the first one reached from the
 *   root, breadth-first). Any further parent in the tree — e.g. in a cousin marriage — is connected
 *   with a secondary link instead of duplicating the person.
 * - Partners who are themselves descendants keep their own place and are joined by an arched
 *   partnership link.
 * - Collapsed people keep their place but their descendants are not laid out.
 */

export interface LayoutOptions {
  cardWidth: number;
  cardHeight: number;
  /** Horizontal gap between sibling subtrees. */
  siblingGap: number;
  /** Horizontal gap between partners in a family unit. */
  partnerGap: number;
  /** Vertical distance between generation bands (card top to card top). */
  levelHeight: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = { cardWidth: 188, cardHeight: 76, siblingGap: 28, partnerGap: 18, levelHeight: 156 };

export interface LayoutNode {
  id: string;
  /** Top-left corner of the card. */
  x: number;
  y: number;
  level: number;
  /** `descendant` of the root, or `partner` who married into the family unit. */
  role: 'descendant' | 'partner';
  /** Children that exist but are not shown (not loaded yet, or collapsed). */
  hiddenChildren: number;
  collapsed: boolean;
}

export type LinkKind = 'parent' | 'secondary-parent' | 'partner';

export interface LayoutLink {
  id: string;
  kind: LinkKind;
  /** SVG path data. */
  d: string;
  /** People this link connects (for highlighting). */
  people: string[];
  subtype: TreeEdge['subtype'];
  verification: TreeEdge['verification'];
  status: TreeEdge['status'];
  /** Bounding box, for viewport culling. */
  box: { x1: number; y1: number; x2: number; y2: number };
}

export interface LayoutBand {
  level: number;
  y: number;
  /** Generation number of the people in this band, when known. */
  generation: number | null;
}

export interface TreeLayout {
  nodes: LayoutNode[];
  links: LayoutLink[];
  bands: LayoutBand[];
  bounds: { x: number; y: number; width: number; height: number };
  /** People in the window that are not connected to the root (not drawn). */
  unplaced: string[];
}

interface Unit {
  person: string;
  partners: string[];
  /** Child groups in drawing order; `with` is the co-parent among `partners` (or null). */
  groups: { with: string | null; children: string[] }[];
  width: number;
  subtree: number;
}

export function layoutFamilyTree(
  rootId: string | null,
  nodesIn: TreeNode[],
  edges: TreeEdge[],
  collapsed: ReadonlySet<string> = new Set(),
  o: LayoutOptions = DEFAULT_LAYOUT,
): TreeLayout {
  const empty: TreeLayout = { nodes: [], links: [], bands: [], bounds: { x: 0, y: 0, width: 0, height: 0 }, unplaced: nodesIn.map((n) => n.id) };
  const byId = new Map(nodesIn.map((n) => [n.id, n]));
  if (!rootId || !byId.has(rootId)) return empty;

  const parentEdges = edges.filter((e) => e.type === 'parent_child' && byId.has(e.from) && byId.has(e.to));
  const partnerEdges = edges.filter((e) => e.type === 'partnership' && byId.has(e.from) && byId.has(e.to));
  const childrenOf = new Map<string, TreeEdge[]>();
  const parentsOf = new Map<string, TreeEdge[]>();
  for (const e of parentEdges) {
    childrenOf.set(e.from, [...(childrenOf.get(e.from) ?? []), e]);
    parentsOf.set(e.to, [...(parentsOf.get(e.to) ?? []), e]);
  }
  const partnersOf = new Map<string, TreeEdge[]>();
  for (const e of partnerEdges) {
    partnersOf.set(e.from, [...(partnersOf.get(e.from) ?? []), e]);
    partnersOf.set(e.to, [...(partnersOf.get(e.to) ?? []), e]);
  }
  const birth = (id: string) => byId.get(id)?.birthDate?.sortKey ?? Number.MAX_SAFE_INTEGER;
  const byBirth = (a: string, b: string) => birth(a) - birth(b) || (byId.get(a)!.displayName).localeCompare(byId.get(b)!.displayName);

  // 1. Descendants of the root, breadth-first; the first parent to reach a child is its primary parent.
  const level = new Map<string, number>([[rootId, 0]]);
  const primaryParent = new Map<string, string>();
  const order = [rootId];
  for (let i = 0; i < order.length; i++) {
    const p = order[i]!;
    if (collapsed.has(p)) continue;
    for (const e of [...(childrenOf.get(p) ?? [])].sort((a, b) => byBirth(a.to, b.to))) {
      if (level.has(e.to)) continue;
      level.set(e.to, level.get(p)! + 1);
      primaryParent.set(e.to, p);
      order.push(e.to);
    }
  }
  const isDescendant = (id: string) => level.has(id);

  // 2. Partners who married in sit beside the first descendant they are partnered with.
  const attachedTo = new Map<string, string>();
  const partnersBeside = new Map<string, string[]>();
  for (const d of order) {
    for (const e of partnersOf.get(d) ?? []) {
      const other = e.from === d ? e.to : e.from;
      if (isDescendant(other) || attachedTo.has(other)) continue;
      attachedTo.set(other, d);
      partnersBeside.set(d, [...(partnersBeside.get(d) ?? []), other]);
      level.set(other, level.get(d)!);
    }
  }

  // 3. Family units with children grouped by co-parent.
  const units = new Map<string, Unit>();
  for (const d of order) {
    const partners = partnersBeside.get(d) ?? [];
    const kids = order.filter((c) => primaryParent.get(c) === d);
    const groups = [{ with: null as string | null, children: [] as string[] }, ...partners.map((p) => ({ with: p as string | null, children: [] as string[] }))];
    for (const c of kids) {
      const coParent = partners.find((p) => (parentsOf.get(c) ?? []).some((e) => e.from === p));
      groups.find((g) => g.with === (coParent ?? null))!.children.push(c);
    }
    const n = 1 + partners.length;
    units.set(d, { person: d, partners, groups: groups.filter((g) => g.children.length), width: n * o.cardWidth + (n - 1) * o.partnerGap, subtree: 0 });
  }

  // 4. Subtree widths (post-order), then positions (pre-order).
  for (const d of [...order].reverse()) {
    const u = units.get(d)!;
    const kids = u.groups.flatMap((g) => g.children);
    const kidsWidth = kids.reduce((w, c) => w + units.get(c)!.subtree, 0) + Math.max(0, kids.length - 1) * o.siblingGap;
    u.subtree = Math.max(u.width, kidsWidth);
  }

  const x = new Map<string, number>();
  const place = (d: string, left: number) => {
    const u = units.get(d)!;
    const kids = u.groups.flatMap((g) => g.children);
    const kidsWidth = kids.reduce((w, c) => w + units.get(c)!.subtree, 0) + Math.max(0, kids.length - 1) * o.siblingGap;
    const unitLeft = left + (u.subtree - u.width) / 2;
    // The descendant sits on the left of the unit, partners to the right in order.
    x.set(d, unitLeft);
    u.partners.forEach((p, i) => x.set(p, unitLeft + (i + 1) * (o.cardWidth + o.partnerGap)));
    let cursor = left + (u.subtree - kidsWidth) / 2;
    for (const c of kids) {
      place(c, cursor);
      cursor += units.get(c)!.subtree + o.siblingGap;
    }
  };
  place(rootId, 0);

  const y = (lvl: number) => lvl * o.levelHeight;
  const nodes: LayoutNode[] = [...x.entries()].map(([id, nx]) => {
    const shownChildren = (childrenOf.get(id) ?? []).filter((e) => primaryParent.get(e.to) === id || x.has(e.to)).length;
    const total = byId.get(id)!.childCount;
    const isCollapsed = collapsed.has(id);
    return {
      id,
      x: nx,
      y: y(level.get(id)!),
      level: level.get(id)!,
      role: attachedTo.has(id) ? 'partner' : 'descendant',
      hiddenChildren: isCollapsed ? total : Math.max(0, total - shownChildren),
      collapsed: isCollapsed,
    };
  });

  // 5. Links.
  const links: LayoutLink[] = [];
  const { cardWidth: W, cardHeight: H } = o;
  const left = (id: string) => x.get(id)!;
  const top = (id: string) => y(level.get(id)!);
  const centre = (id: string) => left(id) + W / 2;
  const box = (xs: number[], ys: number[]) => ({ x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) });

  // Partnerships.
  for (const e of partnerEdges) {
    if (!x.has(e.from) || !x.has(e.to)) continue;
    const [a, b] = left(e.from) <= left(e.to) ? [e.from, e.to] : [e.to, e.from];
    const ya = top(a) + H / 2;
    const yb = top(b) + H / 2;
    const adjacent = attachedTo.get(b) === a || attachedTo.get(a) === b;
    let d: string;
    let linkBox;
    if (adjacent && ya === yb) {
      d = `M${left(a) + W},${ya} H${left(b)}`;
      linkBox = box([left(a) + W, left(b)], [ya - 3, ya + 3]);
    } else {
      // Arc above the cards between two descendants who are partners (e.g. cousins).
      const lift = Math.min(120, 40 + Math.abs(left(b) - left(a)) / 6);
      const yTop = Math.min(top(a), top(b)) - 14;
      d = `M${centre(a)},${top(a)} C${centre(a)},${yTop - lift} ${centre(b)},${yTop - lift} ${centre(b)},${top(b)}`;
      // A cubic Bézier stays within 3/4 of its control-point lift.
      linkBox = box([centre(a), centre(b)], [yTop - lift * 0.75, Math.max(top(a), top(b))]);
    }
    links.push({ id: e.id, kind: 'partner', d, people: [e.from, e.to], subtype: e.subtype, verification: e.verification, status: e.status, box: linkBox });
  }

  // Parent → child: from the couple (or the single parent) to a sibling bar, then down to each child.
  for (const d of order) {
    const u = units.get(d)!;
    if (!x.has(d)) continue;
    u.groups.forEach((g, gi) => {
      const fromX = g.with ? (centre(d) + centre(g.with)) / 2 : centre(d);
      const fromY = top(d) + (g.with ? H / 2 : H);
      const childTop = top(g.children[0]!);
      const barY = childTop - o.levelHeight / 2 + 18 + gi * 10;
      for (const c of g.children) {
        const edge = (parentsOf.get(c) ?? []).find((e) => e.from === d)!;
        const path = `M${fromX},${fromY} V${barY} H${centre(c)} V${childTop}`;
        links.push({
          id: edge.id,
          kind: 'parent',
          d: path,
          people: g.with ? [d, g.with, c] : [d, c],
          subtype: edge.subtype,
          verification: edge.verification,
          status: null,
          box: box([fromX, centre(c)], [fromY, childTop]),
        });
      }
    });
  }

  // Other parents of placed children (second biological parent elsewhere in the tree,
  // adoptive or step parents) that the unit connector does not already represent.
  for (const e of parentEdges) {
    if (!x.has(e.from) || !x.has(e.to)) continue;
    const primary = primaryParent.get(e.to);
    if (primary === e.from) continue;
    const unitPartners = primary ? (units.get(primary)?.groups.find((g) => g.children.includes(e.to))?.with ?? null) : null;
    if (unitPartners === e.from) continue;
    const sx = centre(e.from);
    const sy = top(e.from) + H;
    const tx = centre(e.to) + 18;
    const ty = top(e.to);
    const mid = (sy + ty) / 2;
    links.push({
      id: e.id,
      kind: 'secondary-parent',
      d: `M${sx},${sy} C${sx},${mid} ${tx},${mid} ${tx},${ty}`,
      people: [e.from, e.to],
      subtype: e.subtype,
      verification: e.verification,
      status: null,
      box: box([sx, tx], [Math.min(sy, ty), Math.max(sy, ty)]),
    });
  }

  // Bands.
  const maxLevel = Math.max(...nodes.map((n) => n.level));
  const rootGen = byId.get(rootId)!.generation.number;
  const bands: LayoutBand[] = Array.from({ length: maxLevel + 1 }, (_, lvl) => ({ level: lvl, y: y(lvl), generation: rootGen != null ? rootGen + lvl : null }));

  const xs = nodes.map((n) => n.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs) + W;
  const minY = Math.min(0, ...links.filter((l) => l.kind === 'partner').map((l) => l.box.y1));
  const maxY = y(maxLevel) + H;
  return {
    nodes,
    links,
    bands,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    unplaced: nodesIn.map((n) => n.id).filter((id) => !x.has(id)),
  };
}
