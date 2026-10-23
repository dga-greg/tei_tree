import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, computed, effect, inject, input, output, viewChild } from '@angular/core';
import type { PlaceFlow, PlaceView, PublicConfig } from '@fh/contracts';
import type * as Leaflet from 'leaflet';
import { mark, t } from '../../core/i18n/i18n';

type Located = PlaceView & { latitude: number; longitude: number };

export const placeTotal = (p: PlaceView) => p.counts.births + p.counts.deaths + p.counts.hometowns + p.counts.events;
const radius = (p: PlaceView) => Math.min(20, 5 + Math.sqrt(placeTotal(p)) * 2.5);
const FLOW_LABEL: Record<PlaceFlow['kind'], string> = {
  generation: mark('born here, their children born there'),
  lifetime: mark('born here, lived or died there'),
};
export const flowTitle = (f: PlaceFlow) =>
  t('{from} → {to}: {count, plural, one {# person} other {# people}} ({kind})', { from: f.from.name, to: f.to.name, count: f.people, kind: t(FLOW_LABEL[f.kind]) });

/** A gentle curve between two points, so flows both ways stay apart: the control point sits off to the right. */
function curve(a: [number, number], b: [number, number], bend = 0.18): [number, number] {
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return [mx - (b[1] - a[1]) * bend, my + (b[0] - a[0]) * bend];
}

/**
 * The family's places on a map, with lines for how the family moved. With map tiles from the server it is a
 * street map (Leaflet, loaded only here); without, the places are drawn to scale on a plain background.
 */
@Component({
  selector: 'fh-places-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./leaflet.css'],
  styles: [
    `.fh-map .leaflet-container { font: inherit; background: var(--color-stone-100); }
     .fh-map .leaflet-tooltip { font-size: 0.8125rem; }
     .fh-map .leaflet-control-attribution { font-size: 0.6875rem; }`,
  ],
  host: { class: 'fh-map block' },
  template: `
    @if (tiles()) {
      <div #leafletHost class="h-[min(28rem,60dvh)] w-full overflow-hidden rounded-xl" role="img" [attr.aria-label]="label()"></div>
    } @else {
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" class="h-auto max-h-[28rem] w-full rounded-xl bg-stone-50 dark:bg-stone-900" role="img" [attr.aria-label]="label()">
        <defs>
          <marker id="fh-arrow-generation" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="fill-brand-700 dark:fill-brand-300" /></marker>
          <marker id="fh-arrow-lifetime" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="fill-gold-700 dark:fill-gold-300" /></marker>
          <pattern id="fh-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" class="fill-stone-200 dark:fill-stone-800" /></pattern>
        </defs>
        <rect [attr.width]="W" [attr.height]="H" fill="url(#fh-dots)" />
        @for (f of sketch().flows; track $index) {
          <path [attr.d]="f.d" fill="none" stroke-linecap="round" [attr.stroke-width]="f.width" [attr.stroke-dasharray]="f.kind === 'lifetime' ? '6 5' : null"
                [attr.marker-end]="'url(#fh-arrow-' + f.kind + ')'"
                [class]="f.kind === 'generation' ? 'stroke-brand-700/70 dark:stroke-brand-300/70' : 'stroke-gold-700/80 dark:stroke-gold-300/80'"><title>{{ f.title }}</title></path>
        }
        @for (p of sketch().points; track p.id) {
          <g class="cursor-pointer" (click)="select.emit(p.id)">
            <title>{{ p.title }}</title>
            <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.r + 6" fill="transparent" />
            <circle [attr.cx]="p.x" [attr.cy]="p.y" [attr.r]="p.r" stroke-width="2" class="stroke-white dark:stroke-stone-900"
                    [class]="p.id === selected() ? 'fill-gold-500' : 'fill-brand-600 dark:fill-brand-400'" />
            @if (p.label) {
              <text [attr.x]="p.x + p.r + 5" [attr.y]="p.y + 4" class="fill-stone-800 text-[12px] font-medium dark:fill-stone-100"
                    style="paint-order: stroke; stroke-width: 3px" [class]="'stroke-stone-50 dark:stroke-stone-900'">{{ p.name }}</text>
            }
          </g>
        }
      </svg>
    }
  `,
})
export class PlacesMapComponent {
  readonly places = input.required<PlaceView[]>();
  readonly flows = input<PlaceFlow[]>([]);
  readonly tiles = input<PublicConfig['mapTiles']>(null);
  readonly selected = input<string | null>(null);
  readonly select = output<string>();

  protected readonly W = 640;
  protected readonly H = 400;
  private readonly host = viewChild<ElementRef<HTMLElement>>('leafletHost');
  private readonly element = inject(ElementRef<HTMLElement>);
  private map: Leaflet.Map | null = null;
  private layer: Leaflet.LayerGroup | null = null;
  private L: typeof Leaflet | null = null;

  protected readonly located = computed(() => this.places().filter((p): p is Located => p.latitude != null && p.longitude != null));
  protected readonly label = computed(() =>
    t('Map of {count, plural, one {# place} other {# places}} and {movements} movements between them. The same places are listed below.', { count: this.located().length, movements: this.flows().length }),
  );

  /** Places projected onto the plain background (equirectangular, corrected for latitude), fitted with a margin. */
  protected readonly sketch = computed(() => {
    const pts = this.located();
    if (!pts.length) return { points: [], flows: [] };
    const k = Math.cos((pts.reduce((s, p) => s + p.latitude, 0) / pts.length) * (Math.PI / 180));
    const raw = pts.map((p) => [p.longitude * k, -p.latitude] as const);
    const xs = raw.map((r) => r[0]);
    const ys = raw.map((r) => r[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 48;
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const scale = Math.min((this.W - pad * 2) / Math.max(maxX - minX, span * 0.01), (this.H - pad * 2) / Math.max(maxY - minY, span * 0.01));
    const ox = (this.W - (maxX - minX) * scale) / 2;
    const oy = (this.H - (maxY - minY) * scale) / 2;
    // Label the busiest places; the rest are named on hover and in the list.
    const labelled = new Set([...pts].sort((a, b) => placeTotal(b) - placeTotal(a)).slice(0, 10).map((p) => p.id));
    const points = pts.map((p, i) => ({
      id: p.id,
      name: p.name,
      x: ox + (raw[i]![0] - minX) * scale,
      y: oy + (raw[i]![1] - minY) * scale,
      r: radius(p),
      label: labelled.has(p.id),
      title: t('{name}: {count, plural, one {# record} other {# records}}', { name: p.name, count: placeTotal(p) }),
    }));
    const at = new Map(points.map((p) => [p.id, p]));
    const flows = this.flows().flatMap((f) => {
      const a = at.get(f.from.id);
      const b = at.get(f.to.id);
      if (!a || !b) return [];
      // Stop short of the destination's dot so the arrow head shows.
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const end: [number, number] = [b.x - ((b.x - a.x) / len) * (b.r + 3), b.y - ((b.y - a.y) / len) * (b.r + 3)];
      const c = curve([a.x, a.y], end);
      return [{ kind: f.kind, d: `M${a.x},${a.y} Q${c[0]},${c[1]} ${end[0]},${end[1]}`, width: Math.min(6, 1.5 + Math.log2(f.people + 1)), title: flowTitle(f) }];
    });
    return { points, flows };
  });

  constructor() {
    effect(() => {
      const tiles = this.tiles();
      const host = this.host();
      const places = this.located();
      const flows = this.flows();
      const selected = this.selected();
      if (tiles && host) void this.drawLeaflet(host.nativeElement, tiles, places, flows, selected);
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
  }

  private colour(name: string, fallback: string): string {
    return getComputedStyle(this.element.nativeElement).getPropertyValue(name).trim() || fallback;
  }

  private async drawLeaflet(el: HTMLElement, tiles: NonNullable<PublicConfig['mapTiles']>, places: Located[], flows: PlaceFlow[], selected: string | null): Promise<void> {
    const L = (this.L ??= await loadLeaflet());
    if (!this.map) {
      this.map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true });
      // The app sends no Referer anywhere (links carry tokens), but tile services such as OpenStreetMap refuse
      // requests without one: map images alone send the site's origin, never the page address.
      L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: tiles.maxZoom, referrerPolicy: 'strict-origin' }).addTo(this.map);
      this.layer = L.layerGroup().addTo(this.map);
      this.map.setView([7.95, -1.03], 6);
    }
    const layer = this.layer!;
    layer.clearLayers();
    const brand = this.colour('--color-brand-700', '#22563a');
    const gold = this.colour('--color-gold-700', '#8f6a0c');
    const at = new Map(places.map((p) => [p.id, p]));
    for (const f of flows) {
      const a = at.get(f.from.id);
      const b = at.get(f.to.id);
      if (!a || !b) continue;
      const c = curve([a.latitude, a.longitude], [b.latitude, b.longitude]);
      const line = Array.from({ length: 17 }, (_, i) => {
        const s = i / 16;
        return [(1 - s) ** 2 * a.latitude + 2 * (1 - s) * s * c[0] + s ** 2 * b.latitude, (1 - s) ** 2 * a.longitude + 2 * (1 - s) * s * c[1] + s ** 2 * b.longitude] as [number, number];
      });
      L.polyline(line, { color: f.kind === 'generation' ? brand : gold, weight: Math.min(6, 1.5 + Math.log2(f.people + 1)), opacity: 0.8, dashArray: f.kind === 'lifetime' ? '6 5' : undefined })
        .bindTooltip(flowTitle(f), { sticky: true })
        .addTo(layer);
    }
    for (const p of places) {
      L.circleMarker([p.latitude, p.longitude], { radius: radius(p), color: '#fff', weight: 2, fillColor: p.id === selected ? this.colour('--color-gold-500', '#d4a017') : brand, fillOpacity: 0.92 })
        .bindTooltip(`<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(t('{count, plural, one {# record} other {# records}}', { count: placeTotal(p) }))}`)
        .on('click', () => this.select.emit(p.id))
        .addTo(layer);
    }
    if (places.length && !selected) {
      const bounds = L.latLngBounds(places.map((p) => [p.latitude, p.longitude] as [number, number]));
      this.map!.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }
    this.map!.invalidateSize();
  }
}

/**
 * Leaflet is an old-style (UMD) package: the development server hands its functions over directly, but the production
 * build puts them under `default`, so `L.map` was missing there and the map never drew.
 */
async function loadLeaflet(): Promise<typeof Leaflet> {
  const mod = (await import('leaflet')) as typeof Leaflet & { default?: typeof Leaflet };
  return typeof mod.map === 'function' ? mod : mod.default!;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
