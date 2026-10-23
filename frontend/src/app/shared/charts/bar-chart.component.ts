import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, inject, input, viewChild, type OnDestroy } from '@angular/core';
import type { Chart, ChartConfiguration } from 'chart.js';
import { ThemeService } from '../../core/theme/theme.service';
import { DARK, LIGHT, type ChartTheme } from './chart-theme';

/**
 * Chart.js is fetched the first time a chart is drawn, not with the page: it is the largest part of the dashboard,
 * and the page's figures should not wait for it.
 */
let chartJs: Promise<typeof Chart> | null = null;
function loadChartJs(): Promise<typeof Chart> {
  chartJs ??= import('chart.js').then(({ BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip }) => {
    Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);
    return Chart;
  });
  return chartJs;
}

export interface BarSeries {
  key: keyof Pick<ChartTheme, 'living' | 'unknown' | 'deceased' | 'single'>;
  label: string;
  values: number[];
}

/**
 * Bar chart (stacked when given several series). Thin bars with rounded data ends, a 2px surface
 * gap between stacked segments, recessive grid, hover tooltip, and an HTML legend when there is
 * more than one series. The accessible name and summary come from the caller; a table view must be
 * provided next to it.
 */
@Component({
  selector: 'fh-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (series().length > 1) {
      <ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 dark:text-stone-300" aria-hidden="true">
        @for (s of series(); track s.key) {
          <li class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm" [style.background]="colour(s.key)"></span>{{ s.label }}</li>
        }
      </ul>
    }
    <div class="relative" [style.height.px]="height()">
      <canvas #canvas role="img" [attr.aria-label]="ariaLabel()"></canvas>
    </div>
  `,
})
export class BarChartComponent implements OnDestroy {
  readonly labels = input.required<string[]>();
  readonly series = input.required<BarSeries[]>();
  readonly ariaLabel = input.required<string>();
  readonly height = input(240);
  /** Label of the x axis values in tooltips, e.g. "Generation". */
  readonly tooltipTitle = input<(label: string) => string>((l) => l);

  private readonly theme = inject(ThemeService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart<'bar'> | null = null;
  /** Counts renders, so a slow first load of Chart.js cannot draw over a newer render, or after destroy. */
  private renders = 0;

  constructor() {
    // Runs after the canvas exists, and again when the data or theme changes.
    afterRenderEffect(() => this.render(this.theme.isDark() ? DARK : LIGHT));
  }

  protected colour(key: BarSeries['key']): string {
    return (this.theme.isDark() ? DARK : LIGHT)[key];
  }

  private render(t: ChartTheme): void {
    const run = ++this.renders;
    const series = this.series();
    const stacked = series.length > 1;
    const title = this.tooltipTitle();
    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: this.labels(),
        datasets: series.map((s) => ({
          label: s.label,
          data: s.values,
          backgroundColor: t[s.key],
          hoverBackgroundColor: t[s.key],
          borderColor: t.surface,
          borderWidth: stacked ? { top: 2 } : 0,
          borderSkipped: 'bottom',
          borderRadius: 4,
          maxBarThickness: 36,
          categoryPercentage: 0.7,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked, grid: { display: false }, border: { color: t.grid }, ticks: { color: t.muted, font: { family: 'Sora', size: 11 } } },
          y: {
            stacked,
            beginAtZero: true,
            grid: { color: t.grid },
            border: { display: false },
            ticks: { color: t.muted, precision: 0, font: { family: 'Sora', size: 11 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: t.surface,
            titleColor: t.text,
            bodyColor: t.text,
            borderColor: t.grid,
            borderWidth: 1,
            padding: 10,
            boxPadding: 4,
            callbacks: { title: (items) => title(items[0]?.label ?? '') },
          },
        },
      },
    };
    const canvas = this.canvas().nativeElement;
    void loadChartJs().then((ChartJs) => {
      if (run !== this.renders) return;
      this.chart?.destroy();
      this.chart = new ChartJs(canvas, config);
    });
  }

  ngOnDestroy(): void {
    this.renders++;
    this.chart?.destroy();
  }
}
