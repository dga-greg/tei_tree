import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { TourService, tourTarget } from '../core/tour/tour.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where the step's card goes: a CSS position in pixels, or the middle of the screen. */
interface CardPlace {
  center?: boolean;
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

const GAP = 12;
const EDGE = 16;
const CARD_WIDTH = 352;
/** Room the card needs below its element before it goes above instead. */
const CARD_ROOM = 240;

/**
 * The welcome tour: dims the page, lights up one element at a time and explains it in a small card. On phones the
 * card sits along the top or bottom edge, away from the element.
 */
@Component({
  selector: 'fh-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, TranslatePipe],
  host: {
    '(window:resize)': 'measure()',
    '(window:scroll)': 'measure()',
    '(document:keydown)': 'onKey($event)',
  },
  template: `
    @if (tour.current(); as step) {
      <div class="fixed inset-0 z-[60]" data-testid="tour">
        @if (spot(); as s) {
          <div class="pointer-events-none fixed rounded-xl ring-2 ring-brand-400 transition-all duration-200 motion-reduce:transition-none"
               style="box-shadow: 0 0 0 9999px rgb(12 10 9 / 0.6)"
               [style.top.px]="s.top" [style.left.px]="s.left" [style.width.px]="s.width" [style.height.px]="s.height"></div>
        } @else {
          <div class="fixed inset-0 bg-stone-950/60"></div>
        }

        <div #card role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
             cdkTrapFocus [cdkTrapFocusAutoCapture]="true"
             class="card fixed p-5 shadow-(--shadow-raised) sm:w-[22rem]"
             [class.-translate-x-1/2]="place().center" [class.-translate-y-1/2]="place().center"
             [style.top]="place().center ? '50%' : px(place().top)" [style.left]="place().center ? '50%' : px(place().left)"
             [style.bottom]="px(place().bottom)" [style.right]="px(place().right)"
             [style.width]="place().center && narrow() ? 'calc(100vw - 2rem)' : null">
          <p class="text-xs font-medium text-stone-500">{{ 'Step {n} of {total}' | t: { n: tour.index()! + 1, total: tour.steps().length } }}</p>
          <h2 id="tour-title" class="mt-1 text-lg font-semibold">{{ step.title | t }}</h2>
          <p id="tour-body" class="mt-2 text-sm text-stone-600 dark:text-stone-300">{{ step.body | t }}</p>
          <div class="mt-3 flex gap-1.5" aria-hidden="true">
            @for (s of tour.steps(); track $index) {
              <span class="h-1.5 rounded-full transition-all" [class]="$index === tour.index() ? 'w-5 bg-brand-600' : 'w-1.5 bg-stone-300 dark:bg-stone-600'"></span>
            }
          </div>
          <div class="mt-4 flex items-center gap-2">
            @if (!last()) {
              <button type="button" class="btn-ghost -ml-2 !px-2 text-sm" (click)="tour.end()">{{ 'Skip tour' | t }}</button>
            }
            <span class="ml-auto"></span>
            @if (tour.index()! > 0) {
              <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="tour.back()">{{ 'Back' | t }}</button>
            }
            <button #next type="button" class="btn-primary !py-1.5 text-sm" (click)="tour.next()">
              {{ last() ? ('Done' | t) : tour.index() === 0 ? ('Show me around' | t) : ('Next' | t) }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class TourComponent {
  protected readonly tour = inject(TourService);
  private readonly nextButton = viewChild<ElementRef<HTMLButtonElement>>('next');

  protected readonly spot = signal<Box | null>(null);
  protected readonly place = signal<CardPlace>({ center: true });
  protected readonly narrow = signal(false);

  constructor() {
    effect(() => {
      const step = this.tour.current();
      if (!step) return;
      untracked(() => {
        const el = step.target ? tourTarget(step.target) : null;
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.top < 64 || r.bottom > innerHeight) el.scrollIntoView({ block: 'center' });
        }
        requestAnimationFrame(() => {
          this.measure();
          this.nextButton()?.nativeElement.focus({ preventScroll: true });
        });
      });
    });
  }

  protected last(): boolean {
    return this.tour.index() === this.tour.steps().length - 1;
  }

  protected px(v: number | undefined): string | null {
    return v === undefined ? null : `${Math.round(v)}px`;
  }

  /** Lights up the step's element and places the card next to it (or along an edge on phones). */
  protected measure(): void {
    const step = this.tour.current();
    if (!step) return;
    const vw = innerWidth;
    const vh = innerHeight;
    this.narrow.set(vw < 640);
    const el = step.target ? tourTarget(step.target) : null;
    if (!el) {
      this.spot.set(null);
      this.place.set({ center: true });
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    const s = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    this.spot.set(s);

    if (vw < 640) {
      // Phones: full width along whichever edge is further from the element.
      const below = s.top + s.height / 2 < vh / 2;
      this.place.set(below ? { bottom: EDGE, left: EDGE, right: EDGE } : { top: EDGE, left: EDGE, right: EDGE });
    } else if (s.height > vh * 0.5) {
      // A tall element (the sidebar): beside it.
      this.place.set({ top: Math.min(96, vh - CARD_ROOM), left: Math.min(s.left + s.width + GAP, vw - CARD_WIDTH - EDGE) });
    } else {
      const left = Math.max(EDGE, Math.min(s.left, vw - CARD_WIDTH - EDGE));
      this.place.set(s.top + s.height + GAP + CARD_ROOM < vh ? { top: s.top + s.height + GAP, left } : { bottom: vh - s.top + GAP, left });
    }
  }

  protected onKey(e: KeyboardEvent): void {
    if (!this.tour.active()) return;
    if (e.key === 'Escape') this.tour.end();
    else if (e.key === 'ArrowRight') this.tour.next();
    else if (e.key === 'ArrowLeft') this.tour.back();
    else return;
    e.preventDefault();
  }
}
