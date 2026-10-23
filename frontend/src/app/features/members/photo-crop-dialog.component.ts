import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { LucideRotateCw, LucideZoomIn, LucideZoomOut } from '@lucide/angular';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';

export interface PhotoCropData {
  file: File;
}

/** Size of the saved square picture, in pixels. */
const OUTPUT = 800;
const MAX_ZOOM = 4;

/**
 * Crops a picture to the square shown in profile circles: drag (or arrow keys) to move it, zoom with the slider,
 * the buttons or +/−, and turn it a quarter at a time. Closes with the cropped JPEG, or undefined when cancelled.
 */
@Component({
  selector: 'fh-photo-crop-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertComponent, LucideZoomIn, LucideZoomOut, LucideRotateCw, TranslatePipe],
  host: { class: 'block card max-h-[92dvh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <h2 class="text-xl font-semibold">{{ 'Crop the photo' | t }}</h2>
    <p class="mt-1 text-sm text-stone-500">{{ 'Drag to move the photo, and zoom so the face fills the circle.' | t }}</p>

    @if (error(); as e) {
      <fh-alert class="mt-4 block">{{ e }}</fh-alert>
    } @else {
      <div
        class="relative mx-auto mt-5 aspect-square w-full max-w-72 cursor-grab touch-none overflow-hidden rounded-2xl bg-stone-100 outline-offset-2 select-none active:cursor-grabbing dark:bg-stone-800"
        tabindex="0"
        role="img"
        [attr.aria-label]="'Photo to crop. Use the arrow keys to move it and plus or minus to zoom.' | t"
        (pointerdown)="grab($event)"
        (pointermove)="drag($event)"
        (pointerup)="release($event)"
        (pointercancel)="release($event)"
        (wheel)="$event.preventDefault(); zoomBy($event.deltaY < 0 ? 1.1 : 1 / 1.1)"
        (keydown)="key($event)"
      >
        <canvas #canvas class="size-full"></canvas>
        <!-- Darkens what falls outside the profile circle. -->
        <div class="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.45)] ring-2 ring-white/80"></div>
      </div>

      <div class="mx-auto mt-4 flex max-w-72 items-center gap-2">
        <button type="button" class="btn-ghost !p-2" (click)="zoomBy(1 / 1.2)" [attr.aria-label]="'Zoom out' | t"><svg lucideZoomOut class="size-4"></svg></button>
        <input type="range" class="min-w-0 flex-1 accent-brand-700" min="1" [max]="maxZoom" step="0.01" [value]="zoom()" (input)="setZoom(+$any($event.target).value)" [attr.aria-label]="'Zoom' | t" />
        <button type="button" class="btn-ghost !p-2" (click)="zoomBy(1.2)" [attr.aria-label]="'Zoom in' | t"><svg lucideZoomIn class="size-4"></svg></button>
        <button type="button" class="btn-ghost !p-2" (click)="rotate()" [attr.aria-label]="'Turn the photo' | t" [title]="'Turn the photo' | t"><svg lucideRotateCw class="size-4"></svg></button>
      </div>
    }

    <div class="mt-6 flex justify-end gap-2">
      <button type="button" class="btn-secondary" (click)="ref.close(undefined)">{{ 'Cancel' | t }}</button>
      <button type="button" class="btn-primary" (click)="done()" [disabled]="!ready() || !!error()">{{ 'Use this photo' | t }}</button>
    </div>
  `,
})
export class PhotoCropDialogComponent {
  protected readonly data = inject<PhotoCropData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<File>>(DialogRef);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly maxZoom = MAX_ZOOM;
  protected readonly zoom = signal(1);
  protected readonly ready = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The picture, turned the way the person chose. */
  private source: HTMLCanvasElement | ImageBitmap | null = null;
  /** Centre of the crop, in source pixels. */
  private cx = 0;
  private cy = 0;
  private pointer: { id: number; x: number; y: number } | null = null;

  constructor() {
    afterNextRender(() => void this.open());
    inject(DestroyRef).onDestroy(() => {
      if (this.source instanceof ImageBitmap) this.source.close();
    });
  }

  private async open(): Promise<void> {
    try {
      // Follows the camera's orientation, so phone photos are the right way up.
      this.source = await createImageBitmap(this.data.file, { imageOrientation: 'from-image' });
    } catch {
      this.error.set(t('This picture could not be opened. Choose a JPEG, PNG or WebP picture.'));
      return;
    }
    this.cx = this.source.width / 2;
    this.cy = this.source.height / 2;
    this.ready.set(true);
    this.draw();
  }

  /** Side of the square crop, in source pixels. */
  private side(): number {
    return Math.min(this.source!.width, this.source!.height) / this.zoom();
  }

  private clamp(): void {
    const half = this.side() / 2;
    this.cx = Math.min(Math.max(this.cx, half), this.source!.width - half);
    this.cy = Math.min(Math.max(this.cy, half), this.source!.height - half);
  }

  private draw(): void {
    const el = this.canvas()?.nativeElement;
    if (!el || !this.source) return;
    const px = Math.round(el.clientWidth * (window.devicePixelRatio || 1)) || OUTPUT;
    if (el.width !== px) el.width = el.height = px;
    this.paint(el, px);
  }

  private paint(target: HTMLCanvasElement, size: number): void {
    this.clamp();
    const side = this.side();
    const ctx = target.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(this.source!, this.cx - side / 2, this.cy - side / 2, side, side, 0, 0, size, size);
  }

  /** Moves the picture by a distance on screen. */
  private moveBy(dx: number, dy: number): void {
    const el = this.canvas()?.nativeElement;
    if (!el || !this.source) return;
    const scale = this.side() / (el.clientWidth || 1);
    this.cx -= dx * scale;
    this.cy -= dy * scale;
    this.draw();
  }

  protected setZoom(z: number): void {
    if (!this.source) return;
    this.zoom.set(Math.min(Math.max(z, 1), MAX_ZOOM));
    this.draw();
  }

  protected zoomBy(factor: number): void {
    this.setZoom(this.zoom() * factor);
  }

  protected grab(e: PointerEvent): void {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  protected drag(e: PointerEvent): void {
    if (this.pointer?.id !== e.pointerId) return;
    this.moveBy(e.clientX - this.pointer.x, e.clientY - this.pointer.y);
    this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  protected release(e: PointerEvent): void {
    if (this.pointer?.id === e.pointerId) this.pointer = null;
  }

  protected key(e: KeyboardEvent): void {
    const step = 12;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) this.moveBy(...moves[e.key]!);
    else if (e.key === '+' || e.key === '=') this.zoomBy(1.1);
    else if (e.key === '-') this.zoomBy(1 / 1.1);
    else return;
    e.preventDefault();
  }

  /** Turns the picture a quarter clockwise. */
  protected rotate(): void {
    const src = this.source;
    if (!src) return;
    const turned = document.createElement('canvas');
    turned.width = src.height;
    turned.height = src.width;
    const ctx = turned.getContext('2d')!;
    ctx.translate(turned.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0);
    [this.cx, this.cy] = [src.height - this.cy, this.cx];
    if (src instanceof ImageBitmap) src.close();
    this.source = turned;
    this.draw();
  }

  protected done(): void {
    if (!this.source) return;
    const out = document.createElement('canvas');
    out.width = out.height = Math.min(OUTPUT, Math.round(this.side()));
    this.paint(out, out.width);
    out.toBlob(
      (blob) => {
        if (!blob) {
          this.error.set(t('This picture could not be opened. Choose a JPEG, PNG or WebP picture.'));
          return;
        }
        const base = this.data.file.name.replace(/\.[^.]{1,8}$/, '') || 'photo';
        this.ref.close(new File([blob], `${base}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9,
    );
  }
}
