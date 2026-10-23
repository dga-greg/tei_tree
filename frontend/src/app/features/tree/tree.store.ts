import { Injectable, computed, inject, signal } from '@angular/core';
import type { TreeEdge, TreeNode, TreeWindow } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { TreeApi } from '../../core/tree/tree.api';
import { layoutFamilyTree } from './layout';

export type HighlightMode = 'ancestors' | 'descendants';

/**
 * State of one family-tree view: the merged graph windows loaded so far, collapsed people,
 * selection and highlighting. Provided per page, not globally.
 */
@Injectable()
export class TreeStore {
  private readonly api = inject(TreeApi);

  private readonly _nodes = signal(new Map<string, TreeNode>());
  private readonly _edges = signal(new Map<string, TreeEdge>());
  readonly rootId = signal<string | null>(null);
  readonly collapsed = signal(new Set<string>());
  readonly selectedId = signal<string | null>(null);
  readonly highlight = signal<{ mode: HighlightMode; of: string } | null>(null);
  /** People on a relationship path, highlighted together (from the relationship finder). */
  readonly pathHighlight = signal<Set<string> | null>(null);
  readonly generationFocus = signal<number | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly truncated = signal(false);
  readonly expanding = signal<string | null>(null);

  private familyId = '';

  readonly nodes = computed(() => this._nodes());
  readonly layout = computed(() => layoutFamilyTree(this.rootId(), [...this._nodes().values()], [...this._edges().values()], this.collapsed()));
  readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? (this._nodes().get(id) ?? null) : null;
  });

  /** People and links lit up by "highlight ancestors / descendants". Null when nothing is highlighted. */
  readonly highlighted = computed<Set<string> | null>(() => {
    const path = this.pathHighlight();
    if (path) return path;
    const h = this.highlight();
    if (!h) return null;
    const edges = [...this._edges().values()].filter((e) => e.type === 'parent_child');
    const next = new Map<string, string[]>();
    for (const e of edges) {
      const [from, to] = h.mode === 'ancestors' ? [e.to, e.from] : [e.from, e.to];
      next.set(from, [...(next.get(from) ?? []), to]);
    }
    const seen = new Set([h.of]);
    const queue = [h.of];
    while (queue.length) for (const n of next.get(queue.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    return seen;
  });

  private replace(w: TreeWindow): void {
    this._nodes.set(new Map(w.nodes.map((n) => [n.id, n])));
    this._edges.set(new Map(w.edges.map((e) => [e.id, e])));
    this.rootId.set(w.rootId);
    this.collapsed.set(new Set());
    this.truncated.set(w.truncated);
  }

  private merge(w: TreeWindow): void {
    this._nodes.update((m) => {
      const out = new Map(m);
      for (const n of w.nodes) out.set(n.id, n);
      return out;
    });
    this._edges.update((m) => {
      const out = new Map(m);
      for (const e of w.edges) out.set(e.id, e);
      return out;
    });
    if (w.truncated) this.truncated.set(true);
  }

  private async run(task: () => Promise<void>): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await task();
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  loadRoot(familyId: string, depth: number): Promise<void> {
    this.familyId = familyId;
    return this.run(async () => this.replace(await this.api.root(familyId, depth)));
  }

  loadBranch(familyId: string, branchId: string, depth: number): Promise<void> {
    this.familyId = familyId;
    return this.run(async () => this.replace(await this.api.branch(familyId, branchId, depth)));
  }

  /** Shows a person's children, fetching them if they were not loaded yet. */
  async expand(id: string): Promise<void> {
    const node = this._nodes().get(id);
    if (!node) return;
    const loadedChildren = [...this._edges().values()].filter((e) => e.type === 'parent_child' && e.from === id && this._nodes().has(e.to)).length;
    if (loadedChildren < node.childCount) {
      this.expanding.set(id);
      try {
        this.merge(await this.api.children(this.familyId, id));
      } catch (err) {
        this.error.set(ApiError.from(err).message);
      } finally {
        this.expanding.set(null);
      }
    }
    this.collapsed.update((s) => {
      const out = new Set(s);
      out.delete(id);
      return out;
    });
  }

  collapse(id: string): void {
    this.collapsed.update((s) => new Set(s).add(id));
  }

  async toggle(id: string): Promise<void> {
    const n = this.layout().nodes.find((x) => x.id === id);
    if (n && !n.collapsed && n.hiddenChildren === 0) this.collapse(id);
    else await this.expand(id);
  }

  /**
   * Loads the line between the root and a person and opens it, so the person becomes visible.
   * Returns false when the person is not connected to the current root.
   */
  async focus(id: string): Promise<boolean> {
    const lineage = new Set<string>();
    let target = id;
    // Ancestor windows are bounded (6 generations); walk up until the root is reached.
    for (let i = 0; i < 8; i++) {
      const window = await this.api.ancestors(this.familyId, target, 6).catch((err: unknown) => {
        this.error.set(ApiError.from(err).message);
        return null;
      });
      if (!window) return false;
      this.merge(window);
      window.nodes.forEach((n) => lineage.add(n.id));
      if (lineage.has(this.rootId() ?? '')) break;
      const parentsInWindow = new Set(window.edges.filter((e) => e.type === 'parent_child').map((e) => e.to));
      const top = window.nodes.find((n) => n.parentCount > 0 && !parentsInWindow.has(n.id) && n.id !== target);
      if (!top) break;
      target = top.id;
    }
    this.collapsed.update((s) => new Set([...s].filter((x) => !lineage.has(x))));
    this.selectedId.set(id);
    return this.layout().nodes.some((n) => n.id === id);
  }

  setHighlight(mode: HighlightMode | null): void {
    this.pathHighlight.set(null);
    const id = this.selectedId();
    this.highlight.set(mode && id ? { mode, of: id } : null);
  }

  edgesOf(id: string): TreeEdge[] {
    return [...this._edges().values()].filter((e) => e.from === id || e.to === id);
  }
}
