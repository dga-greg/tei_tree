import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { PhotoBox, PhotoTag } from '@fh/contracts';

const MIN_SIZE = 0.03;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A photo with the people in it outlined. Boxes are fractions of the photo, so they stay put at any size.
 * In drawing mode, dragging across the photo draws a new box.
 */
@Component({
  selector: 'fh-photo-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'grid size-full place-items-center [container-type:size]' },
  template: `
    <div class="relative" [style.aspect-ratio]="ratio() ?? null" [style.width]="ratio() ? 'min(100cqw, calc(100cqh * ' + ratio() + '))' : null">
      <img [src]="src()" [alt]="alt()" draggable="false" (load)="loaded($event)" class="block select-none" [class]="ratio() ? 'size-full' : 'max-h-[100cqh] max-w-[100cqw] object-contain'" />
      @if (ratio()) {
        @if (showBoxes() || drawing()) {
          @for (t of tags(); track t.person!.id) {
            <div class="pointer-events-none absolute rounded-md border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.55)] transition-colors" [class]="t.person!.id === highlight() ? 'border-gold-300' : 'border-white/90'" [style.left.%]="t.box.x * 100" [style.top.%]="t.box.y * 100" [style.width.%]="t.box.w * 100" [style.height.%]="t.box.h * 100">
              <span class="absolute left-0 top-full mt-1 max-w-48 truncate rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white">{{ t.person!.displayName }}</span>
            </div>
          }
        }
        @if (drawing()) {
          <div class="absolute inset-0 cursor-crosshair touch-none" (pointerdown)="start($event)" (pointermove)="move($event)" (pointerup)="end($event)" (pointercancel)="draft.set(null)" aria-hidden="true"></div>
        }
        @if (draft() ?? pending(); as b) {
          <div class="pointer-events-none absolute rounded-md border-2 border-dashed border-gold-300 bg-gold-300/15 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]" [style.left.%]="b.x * 100" [style.top.%]="b.y * 100" [style.width.%]="b.w * 100" [style.height.%]="b.h * 100"></div>
        }
      }
    </div>
  `,
})
export class PhotoFrameComponent {
  readonly src = input.required<string>();
  readonly alt = input('');
  /** Width ÷ height, when known before the image loads. */
  readonly size = input<{ width: number | null; height: number | null } | null>(null);
  readonly tags = input<PhotoTag[]>([]);
  readonly showBoxes = input(true);
  readonly drawing = input(false);
  /** A drawn box waiting for its person. */
  readonly pending = input<PhotoBox | null>(null);
  readonly highlight = input<string | null>(null);
  readonly drawn = output<PhotoBox>();

  private readonly natural = signal<number | null>(null);
  protected readonly ratio = computed(() => {
    const s = this.size();
    return s?.width && s.height ? s.width / s.height : this.natural();
  });
  protected readonly draft = signal<PhotoBox | null>(null);
  private origin: { x: number; y: number } | null = null;

  protected loaded(e: Event): void {
    const img = e.target as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight) this.natural.set(img.naturalWidth / img.naturalHeight);
  }

  private point(e: PointerEvent): { x: number; y: number } {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  }

  protected start(e: PointerEvent): void {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.origin = this.point(e);
    this.draft.set({ ...this.origin, w: 0, h: 0 });
  }

  protected move(e: PointerEvent): void {
    if (!this.origin) return;
    const p = this.point(e);
    this.draft.set({ x: Math.min(p.x, this.origin.x), y: Math.min(p.y, this.origin.y), w: Math.abs(p.x - this.origin.x), h: Math.abs(p.y - this.origin.y) });
  }

  protected end(e: PointerEvent): void {
    this.move(e);
    const b = this.draft();
    this.origin = null;
    this.draft.set(null);
    if (b && b.w >= MIN_SIZE && b.h >= MIN_SIZE) {
      const round = (v: number) => Math.round(v * 10000) / 10000;
      this.drawn.emit({ x: round(b.x), y: round(b.y), w: round(Math.min(b.w, 1 - b.x)), h: round(Math.min(b.h, 1 - b.y)) });
    }
  }
}
