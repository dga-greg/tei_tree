import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  type OnDestroy,
} from '@angular/core';
import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import type { TreeNode } from '@fh/contracts';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ThemeService } from '../../core/theme/theme.service';
import { lifespan } from '../../shared/people';
import { DEFAULT_LAYOUT, type LayoutLink, type LayoutNode, type TreeLayout } from './layout';
import { TREE_DARK, TREE_LIGHT, dashFor } from './tree-theme';

const W = DEFAULT_LAYOUT.cardWidth;
const H = DEFAULT_LAYOUT.cardHeight;
const CULL_MARGIN = 300;
const ENDED = new Set(['divorced', 'separated', 'annulled']);

const FONT_FAMILY = 'Sora, ui-sans-serif, system-ui, sans-serif';
/** Room for text on a card: from the right of the avatar to just inside the right edge. */
const TEXT_WIDTH = W - 64 - 12;

let measureContext: CanvasRenderingContext2D | null | undefined;
const fitted = new Map<string, string>();

/** Shortens text with an ellipsis so it fits `maxWidth` pixels in the given CSS font. */
function fitText(text: string, font: string, maxWidth = TEXT_WIDTH): string {
  measureContext ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measureContext) return text.length > 18 ? `${text.slice(0, 17)}…` : text;
  const key = `${font}|${text}`;
  const cached = fitted.get(key);
  if (cached !== undefined) return cached;
  measureContext.font = font;
  let result = text;
  if (measureContext.measureText(text).width > maxWidth) {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measureContext.measureText(`${text.slice(0, mid).trimEnd()}…`).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    result = `${text.slice(0, lo).trimEnd()}…`;
  }
  if (fitted.size > 5000) fitted.clear();
  fitted.set(key, result);
  return result;
}

/**
 * Renders a laid-out family tree as SVG. D3 handles zoom and pan only; Angular renders the
 * elements, and only those inside the visible viewport (plus a margin) are drawn, so large trees
 * stay responsive. Cards are focusable buttons for keyboard and screen-reader users.
 */
@Component({
  selector: 'fh-tree-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  host: { class: 'block relative h-full w-full overflow-hidden', '[style.background]': 'theme().canvas' },
  template: `
    <svg #svg class="h-full w-full touch-none select-none" role="group" [attr.aria-label]="ariaLabel() || defaultLabel" xmlns="http://www.w3.org/2000/svg" [attr.font-family]="fontFamily">
      <g #world [attr.transform]="transformAttr()">
        <!-- generation bands -->
        @for (b of layout().bands; track b.level) {
          <rect [attr.x]="layout().bounds.x - 4000" [attr.y]="b.y - 40" [attr.width]="layout().bounds.width + 8000" [attr.height]="levelHeight" [attr.fill]="b.level % 2 ? theme().bandB : theme().bandA" />
          <text [attr.x]="labelX()" [attr.y]="b.y - 18" [attr.fill]="theme().bandLabel" font-size="13" font-weight="600" letter-spacing="0.08em">
            {{ b.generation ? ('GENERATION {generation}' | t: { generation: b.generation }) : ('LEVEL {level}' | t: { level: b.level + 1 }) }}
          </text>
        }

        <!-- links -->
        @for (l of visibleLinks(); track l.id) {
          @if (l.kind === 'partner') {
            <g [attr.opacity]="linkOpacity(l)">
              <path [attr.d]="l.d" fill="none" [attr.stroke]="theme().partner" stroke-width="5" stroke-linecap="round" [attr.stroke-dasharray]="l.verification === 'verified' ? null : '6 4'" />
              <path [attr.d]="l.d" fill="none" [attr.stroke]="theme().canvas" stroke-width="1.6" />
            </g>
          } @else {
            <path [attr.d]="l.d" fill="none" [attr.stroke]="l.verification === 'disputed' ? theme().disputed : theme().link" [attr.stroke-width]="isLit(l) ? 3 : 1.8" [attr.stroke-dasharray]="dash(l)" [attr.opacity]="linkOpacity(l)" stroke-linejoin="round" />
          }
        }

        <!-- people -->
        @for (n of visibleNodes(); track n.id) {
          @if (person(n.id); as p) {
            <g [attr.transform]="'translate(' + n.x + ',' + n.y + ')'" [attr.opacity]="nodeOpacity(n, p)">
              <g class="cursor-pointer outline-none" role="button" tabindex="0" [attr.aria-label]="describe(p, n)" [attr.aria-pressed]="selectedId() === n.id"
                 (click)="selectPerson.emit(n.id)" (keydown.enter)="selectPerson.emit(n.id)" (keydown.space)="$event.preventDefault(); selectPerson.emit(n.id)"
                 (focus)="focused.set(n.id)" (blur)="focused.set(null)">
                <rect [attr.width]="W" [attr.height]="H" rx="14" [attr.fill]="theme().card"
                      [attr.stroke]="selectedId() === n.id || focused() === n.id ? theme().cardSelected : theme().cardBorder"
                      [attr.stroke-width]="selectedId() === n.id ? 3 : focused() === n.id ? 2.5 : 1"
                      [attr.stroke-dasharray]="n.role === 'partner' ? '5 3' : null" />
                @if (lineColours()?.get(n.id); as colour) {
                  <rect x="1" y="10" width="5" [attr.height]="H - 20" rx="2.5" [attr.fill]="colour" />
                }
                <circle cx="34" [attr.cy]="H / 2" r="21" [attr.fill]="theme().avatar" />
                <text x="34" [attr.y]="H / 2 + 5" text-anchor="middle" font-size="14" font-weight="700" [attr.fill]="theme().avatarText">{{ initials(p.displayName) }}</text>
                <text x="64" y="30" font-size="13.5" font-weight="650" [attr.fill]="theme().text">{{ clip(p.displayName, 650, 13.5) }}</text>
                <text x="64" y="49" font-size="11.5" [attr.fill]="theme().muted">{{ clip(span(p) || '—', 400, 11.5) }}</text>
                <text x="64" y="65" font-size="10.5" font-weight="600" [attr.fill]="theme().muted">{{ genLabel(p, n) }}</text>
                @if (p.vitalStatus === 'living') {
                  <circle [attr.cx]="W - 14" cy="14" r="4.5" [attr.fill]="theme().living"><title>{{ 'Living' | t }}</title></circle>
                }
              </g>
              @if (n.hiddenChildren > 0 || hasShownChildren(n.id)) {
                <g class="cursor-pointer" role="button" tabindex="0"
                   [attr.aria-label]="n.hiddenChildren > 0 ? ('{count, plural, one {Show # child of {name}} other {Show # children of {name}}}' | t: { count: n.hiddenChildren, name: p.displayName }) : ('Hide descendants of {name}' | t: { name: p.displayName })"
                   [attr.transform]="'translate(' + (W / 2) + ',' + (H + 12) + ')'"
                   (click)="togglePerson.emit(n.id)" (keydown.enter)="togglePerson.emit(n.id)" (keydown.space)="$event.preventDefault(); togglePerson.emit(n.id)">
                  <circle r="11" [attr.fill]="theme().toggle" />
                  <text text-anchor="middle" y="4" font-size="11" font-weight="700" [attr.fill]="theme().toggleText">{{ expanding() === n.id ? '…' : n.hiddenChildren > 0 ? '+' + n.hiddenChildren : '−' }}</text>
                </g>
              }
            </g>
          }
        }
      </g>
    </svg>
  `,
})
export class TreeCanvasComponent implements OnDestroy {
  readonly layout = input.required<TreeLayout>();
  readonly people = input.required<Map<string, TreeNode>>();
  readonly selectedId = input<string | null>(null);
  readonly highlighted = input<Set<string> | null>(null);
  readonly generationFocus = input<number | null>(null);
  /** Colour of each person's line (tree coloured by lineage), and the line names for screen readers. */
  readonly lineColours = input<Map<string, string> | null>(null);
  readonly lineNames = input<Map<string, string> | null>(null);
  readonly expanding = input<string | null>(null);
  /** The tree's accessible name; defaults to "Family tree" in the active language. */
  readonly ariaLabel = input<string>();
  readonly selectPerson = output<string>();
  readonly togglePerson = output<string>();

  private readonly themeService = inject(ThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  protected readonly W = W;
  protected readonly H = H;
  protected readonly levelHeight = DEFAULT_LAYOUT.levelHeight;
  protected readonly theme = computed(() => (this.themeService.isDark() ? TREE_DARK : TREE_LIGHT));
  protected readonly focused = signal<string | null>(null);
  /** Re-measures names once the web font has loaded (it is wider than the fallback). */
  private readonly fontsReady = signal(0);
  protected readonly span = lifespan;
  protected readonly fontFamily = FONT_FAMILY;
  protected readonly defaultLabel = t('Family tree');

  private readonly transform = signal({ x: 0, y: 0, k: 1 });
  private readonly viewport = signal({ width: 1200, height: 800 });
  /** Disabled while exporting, so the whole tree is in the DOM. */
  private readonly culling = signal(true);
  private behaviour: ZoomBehavior<SVGSVGElement, unknown> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fitted = false;

  protected readonly transformAttr = computed(() => {
    const tr = this.transform();
    return `translate(${tr.x},${tr.y}) scale(${tr.k})`;
  });
  protected readonly labelX = computed(() => {
    const tr = this.transform();
    return (16 - tr.x) / tr.k; // keep band labels pinned to the left edge while panning
  });

  private readonly visibleRect = computed(() => {
    const tr = this.transform();
    const v = this.viewport();
    return { x1: -tr.x / tr.k - CULL_MARGIN, y1: -tr.y / tr.k - CULL_MARGIN, x2: (v.width - tr.x) / tr.k + CULL_MARGIN, y2: (v.height - tr.y) / tr.k + CULL_MARGIN };
  });

  protected readonly visibleNodes = computed(() => {
    const nodes = this.layout().nodes;
    if (!this.culling()) return nodes;
    const r = this.visibleRect();
    return nodes.filter((n) => n.x + W >= r.x1 && n.x <= r.x2 && n.y + H + 30 >= r.y1 && n.y <= r.y2);
  });

  protected readonly visibleLinks = computed(() => {
    const links = this.layout().links;
    if (!this.culling()) return links;
    const r = this.visibleRect();
    return links.filter((l) => l.box.x2 >= r.x1 && l.box.x1 <= r.x2 && l.box.y2 >= r.y1 && l.box.y1 <= r.y2);
  });

  private readonly parentsWithShownChildren = computed(() => {
    const s = new Set<string>();
    for (const l of this.layout().links) if (l.kind === 'parent') s.add(l.people[0]!);
    return s;
  });

  constructor() {
    afterNextRender(() => {
      void document.fonts?.ready.then(() => {
        fitted.clear();
        this.fontsReady.update((n) => n + 1);
      });
      const svgEl = this.svg().nativeElement;
      this.behaviour = zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.08, 2.5])
        .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
          const { x, y, k } = event.transform;
          this.transform.set({ x, y, k });
        });
      select(svgEl).call(this.behaviour).on('dblclick.zoom', null);
      this.resizeObserver = new ResizeObserver(([entry]) => {
        if (entry) this.viewport.set({ width: entry.contentRect.width, height: entry.contentRect.height });
      });
      this.resizeObserver.observe(this.host.nativeElement);
      this.viewport.set({ width: svgEl.clientWidth, height: svgEl.clientHeight });
      if (this.layout().nodes.length) this.initialView();
    });
    // Choose a starting view the first time a tree arrives.
    effect(() => {
      const count = this.layout().nodes.length;
      if (count && !this.fitted && this.behaviour) untracked(() => this.initialView());
    });
  }

  protected person(id: string): TreeNode | undefined {
    return this.people().get(id);
  }

  protected hasShownChildren(id: string): boolean {
    return this.parentsWithShownChildren().has(id);
  }

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  }

  protected clip(text: string, weight: number, size: number): string {
    this.fontsReady();
    return fitText(text, `${weight} ${size}px ${FONT_FAMILY}`);
  }

  protected genLabel(p: TreeNode, n: LayoutNode): string {
    const g = p.generation;
    if (g.status === 'founder') return t('G1 · Founder');
    if (g.number) return t('Generation {number}', { number: g.number });
    if (g.status === 'conflict') return t('G{candidates} · conflict', { candidates: g.candidates.join('/') });
    if (n.role === 'partner' || g.status === 'married_in') return t('Married in');
    if (g.status === 'unverified_path') return t('Unverified link');
    return '';
  }

  protected describe(p: TreeNode, n: LayoutNode): string {
    const parts = [p.displayName, this.span(p), this.genLabel(p, n), p.vitalStatus === 'living' ? t('living') : '', this.lineNames()?.get(n.id) ?? ''];
    if (n.hiddenChildren) parts.push(t('{count, plural, one {# child not shown} other {# children not shown}}', { count: n.hiddenChildren }));
    return parts.filter(Boolean).join(', ');
  }

  protected dash(l: LayoutLink): string | null {
    return dashFor(l.subtype, l.verification);
  }

  /** A link is part of a highlighted line when its child and at least one of its parents are. */
  protected isLit(l: LayoutLink): boolean {
    const h = this.highlighted();
    if (!h || l.kind === 'partner') return false;
    const child = l.people.at(-1)!;
    return h.has(child) && l.people.some((p) => p !== child && h.has(p));
  }

  protected linkOpacity(l: LayoutLink): number {
    const h = this.highlighted();
    const base = l.kind === 'partner' && l.status && ENDED.has(l.status) ? 0.45 : l.verification === 'unverified' ? 0.6 : 1;
    if (!h) return base;
    if (l.kind === 'partner') return l.people.every((p) => h.has(p)) ? base : 0.15;
    return this.isLit(l) ? 1 : 0.15;
  }

  protected nodeOpacity(n: LayoutNode, p: TreeNode): number {
    const h = this.highlighted();
    if (h) return h.has(n.id) ? 1 : 0.25;
    const g = this.generationFocus();
    if (g != null) return p.generation.number === g ? 1 : 0.25;
    return 1;
  }

  // ------------------------------------------------------------------ viewport control

  private apply(x: number, y: number, k: number, animate = true): void {
    if (!this.behaviour) return;
    const sel = select(this.svg().nativeElement);
    const target = zoomIdentity.translate(x, y).scale(k);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduce) sel.transition().duration(350).call(this.behaviour.transform, target);
    else sel.call(this.behaviour.transform, target);
  }

  /** Scale at which the whole tree fits the viewport. */
  private fitScale(): number {
    const b = this.layout().bounds;
    const v = this.viewport();
    const pad = 56;
    return Math.min(1.1, (v.width - pad * 2) / b.width, (v.height - pad * 2) / (b.height + 40));
  }

  fit(animate = true): void {
    const b = this.layout().bounds;
    const v = this.viewport();
    if (!b.width || !v.width) return;
    this.fitted = true;
    const k = this.fitScale();
    // Centre both ways; the extra 40 leaves room for the generation labels above the first band.
    this.apply(v.width / 2 - (b.x + b.width / 2) * k, v.height / 2 - (b.y - 40 + (b.height + 40) / 2) * k, k, animate);
  }

  /**
   * Shows the whole tree when it can be read at that size; otherwise starts at a readable scale
   * with the root at the top centre, so large families do not open as an unreadable thumbnail.
   */
  initialView(): void {
    if (!this.layout().bounds.width || !this.viewport().width) return;
    if (this.fitScale() >= 0.5) this.fit(false);
    else {
      this.fitted = true;
      this.reset(false);
    }
  }

  zoomBy(factor: number): void {
    if (!this.behaviour) return;
    select(this.svg().nativeElement).transition().duration(200).call(this.behaviour.scaleBy, factor);
  }

  /** Root at the top centre, at a readable scale. */
  reset(animate = true): void {
    const n = this.layout().nodes.find((x) => x.level === 0);
    const v = this.viewport();
    const k = 0.8;
    if (n) this.apply(v.width / 2 - (n.x + W / 2) * k, 110 - n.y * k, k, animate);
  }

  centerOn(id: string): void {
    const n = this.layout().nodes.find((x) => x.id === id);
    const v = this.viewport();
    if (!n) return;
    const k = Math.max(this.transform().k, 0.8);
    this.apply(v.width / 2 - (n.x + W / 2) * k, v.height / 2 - (n.y + H / 2) * k, k);
  }

  /** A standalone SVG document of the whole tree (not just the visible part). */
  async exportSvg(): Promise<{ svg: string; width: number; height: number }> {
    this.culling.set(false);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const b = this.layout().bounds;
      const pad = 40;
      const width = Math.ceil(b.width + pad * 2);
      const height = Math.ceil(b.height + pad * 2 + 30);
      const clone = this.svg().nativeElement.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));
      clone.setAttribute('viewBox', `${b.x - pad} ${b.y - pad - 30} ${width} ${height}`);
      clone.removeAttribute('class');
      const world = clone.querySelector('g');
      world?.removeAttribute('transform');
      clone.querySelectorAll('[tabindex]').forEach((el) => el.removeAttribute('tabindex'));
      // Band labels are pinned for on-screen panning; place them at the left edge of the export.
      clone.querySelectorAll('text[letter-spacing]').forEach((el) => el.setAttribute('x', String(b.x - pad + 8)));
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', String(b.x - pad));
      bg.setAttribute('y', String(b.y - pad - 30));
      bg.setAttribute('width', String(width));
      bg.setAttribute('height', String(height));
      bg.setAttribute('fill', this.theme().canvas);
      clone.insertBefore(bg, clone.firstChild);
      return { svg: new XMLSerializer().serializeToString(clone), width, height };
    } finally {
      this.culling.set(true);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }
}
