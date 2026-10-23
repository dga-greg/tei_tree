import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  LucideDownload,
  LucideExpand,
  LucideLocateFixed,
  LucideMaximize,
  LucideMinus,
  LucidePlus,
  LucideRotateCcw,
  LucideSlidersHorizontal,
  LucideX,
} from '@lucide/angular';
import { PARENT_CHILD_SUBTYPE_LABELS, PARTNERSHIP_SUBTYPE_LABELS, type MemberView, type PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FamilyCodeComponent } from '../../shared/ui/family-code.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { TreeCanvasComponent } from './tree-canvas.component';
import { downloadPdf, downloadPng, downloadSvg } from './tree-export';
import { TreeStore } from './tree.store';

@Component({
  selector: 'fh-family-tree-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TreeStore],
  imports: [
    RouterLink,
    FormsModule,
    A11yModule,
    TreeCanvasComponent,
    PersonPickerComponent,
    PersonAvatarComponent,
    FamilyCodeComponent,
    AlertComponent,
    SpinnerComponent,
    NoFamilyComponent,
    LucidePlus,
    LucideMinus,
    LucideExpand,
    LucideRotateCcw,
    LucideMaximize,
    LucideDownload,
    LucideSlidersHorizontal,
    LucideX,
    LucideLocateFixed,
    TranslatePipe,
  ],
  host: { class: 'block', '(document:keydown.escape)': 'filtersOpen.set(false)' },
  template: `
    @if (!context.active()) {
      <div class="p-6">@if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }</div>
    } @else {
      <div #shell class="grid h-[calc(100dvh-4rem)] grid-cols-1 bg-stone-50 lg:grid-cols-[16rem_minmax(0,1fr)_19rem] dark:bg-stone-950">
        <!-- Left: navigation, filters, legend (drawer on small screens) -->
        <aside class="z-30 overflow-y-auto border-r border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900" [class]="filtersOpen() ? 'fixed inset-y-0 left-0 w-80 max-w-[90vw] shadow-2xl lg:static lg:w-auto lg:shadow-none' : 'hidden lg:block'" [attr.aria-label]="'Tree controls' | t" [cdkTrapFocus]="filtersOpen()">
          <div class="mb-3 flex items-center justify-between lg:hidden">
            <h2 class="text-lg font-semibold">{{ 'Tree controls' | t }}</h2>
            <button type="button" class="btn-ghost !p-2" (click)="filtersOpen.set(false)" [attr.aria-label]="'Close tree controls' | t"><svg lucideX class="size-5"></svg></button>
          </div>

          <section class="space-y-2" aria-labelledby="find-h">
            <h2 id="find-h" class="text-sm font-semibold">{{ 'Find a person' | t }}</h2>
            <fh-person-picker [familyId]="context.active()!.id" [label]="'Name' | t" (picked)="onPicked($event)" />
          </section>

          <section class="mt-6 space-y-3" aria-labelledby="view-h">
            <h2 id="view-h" class="text-sm font-semibold">{{ 'View' | t }}</h2>
            <div>
              <label class="label" for="tree-depth">{{ 'Generations to load' | t }}</label>
              <select id="tree-depth" class="input" [ngModel]="depth()" (ngModelChange)="depth.set(+$event)">
                @for (d of [1, 2, 3, 4, 5, 6]; track d) { <option [ngValue]="d">{{ '{depth} below the top' | t: { depth: d } }}</option> }
              </select>
            </div>
          </section>

          <section class="mt-6" aria-labelledby="legend-h">
            <h2 id="legend-h" class="mb-2 text-sm font-semibold">{{ 'Legend' | t }}</h2>
            <ul class="space-y-1.5 text-xs text-stone-600 dark:text-stone-300">
              @for (item of legend; track item.label) {
                <li class="flex items-center gap-2">
                  <svg width="40" height="12" aria-hidden="true">
                    @if (item.double) {
                      <line x1="2" y1="6" x2="38" y2="6" stroke="#b07a06" stroke-width="5" stroke-linecap="round" />
                      <line x1="2" y1="6" x2="38" y2="6" stroke="#fafaf9" stroke-width="1.6" />
                    } @else {
                      <line x1="2" y1="6" x2="38" y2="6" stroke="currentColor" stroke-width="1.8" [attr.stroke-dasharray]="item.dash" [attr.opacity]="item.opacity ?? 1" />
                    }
                  </svg>
                  {{ item.label | t }}
                </li>
              }
              <li class="flex items-center gap-2"><svg width="40" height="12" aria-hidden="true"><rect x="4" y="1" width="32" height="10" rx="3" fill="none" stroke="currentColor" stroke-dasharray="4 2" /></svg>{{ 'Married into the family' | t }}</li>
              <li class="flex items-center gap-2"><svg width="40" height="12" aria-hidden="true"><circle cx="20" cy="6" r="4.5" fill="#2f7d52" /></svg>{{ 'Living' | t }}</li>
            </ul>
          </section>
        </aside>
        @if (filtersOpen()) { <div class="fixed inset-0 z-20 bg-stone-950/40 lg:hidden" (click)="filtersOpen.set(false)" aria-hidden="true"></div> }

        <!-- Centre: the tree -->
        <section #stage class="relative min-h-0 min-w-0" [attr.aria-label]="'Family tree' | t">
          <div class="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2">
            <button type="button" class="btn-secondary !px-3 !py-2 lg:hidden" (click)="filtersOpen.set(true)"><svg lucideSlidersHorizontal class="size-4"></svg> {{ 'Controls' | t }}</button>
            <div class="card flex items-center !rounded-xl p-1" role="toolbar" [attr.aria-label]="'Zoom and view' | t">
              <button type="button" class="btn-ghost !p-2" (click)="canvas()?.zoomBy(1.25)" [attr.aria-label]="'Zoom in' | t"><svg lucidePlus class="size-4"></svg></button>
              <button type="button" class="btn-ghost !p-2" (click)="canvas()?.zoomBy(0.8)" [attr.aria-label]="'Zoom out' | t"><svg lucideMinus class="size-4"></svg></button>
              <button type="button" class="btn-ghost !p-2" (click)="canvas()?.fit()" [attr.aria-label]="'Fit tree to screen' | t"><svg lucideExpand class="size-4"></svg></button>
              <button type="button" class="btn-ghost !p-2" (click)="resetView()" [attr.aria-label]="'Reset view' | t"><svg lucideRotateCcw class="size-4"></svg></button>
              <button type="button" class="btn-ghost !p-2" (click)="toggleFullscreen()" [attr.aria-label]="(isFullscreen() ? 'Exit full screen' : 'Full screen') | t"><svg lucideMaximize class="size-4"></svg></button>
            </div>
            <div class="card flex items-center gap-1 !rounded-xl p-1">
              <span class="hidden px-2 text-xs text-stone-500 sm:inline"><svg lucideDownload class="inline size-3.5"></svg> {{ 'Export' | t }}</span>
              <button type="button" class="btn-ghost !px-2 !py-1.5 text-xs" (click)="exportAs('png')" [disabled]="exporting()">PNG</button> <!-- i18n-ignore -->
              <button type="button" class="btn-ghost !px-2 !py-1.5 text-xs" (click)="exportAs('svg')" [disabled]="exporting()">SVG</button> <!-- i18n-ignore -->
              <button type="button" class="btn-ghost !px-2 !py-1.5 text-xs" (click)="exportAs('pdf')" [disabled]="exporting()">PDF</button> <!-- i18n-ignore -->
            </div>
            @if (store.loading()) { <fh-spinner [label]="'Loading tree…' | t" [showLabel]="true" /> }
          </div>

          @if (store.error(); as e) { <fh-alert class="absolute bottom-3 left-3 right-3 z-10">{{ e }}</fh-alert> }
          @if (notice(); as n) { <fh-alert tone="info" class="absolute bottom-3 left-3 right-3 z-10">{{ n }}</fh-alert> }
          @else if (store.nodes().size === 1 && !store.loading() && !store.selectedId()) {
            <!-- A new family: only the family head so far. -->
            <div class="card absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center gap-3 p-4 sm:left-auto sm:max-w-sm" data-testid="tree-start">
              <p class="min-w-0 flex-1 text-sm">{{ 'The tree grows as you add people. Add the family head’s husband or wife and children to start.' | t }}</p>
              @if (context.can('member.create')) { <a routerLink="/members/new" class="btn-primary !py-1.5 text-sm">{{ 'Add family member' | t }}</a> }
            </div>
          }
          @if (store.truncated()) {
            <p class="absolute bottom-3 left-3 z-10 rounded-lg bg-white/90 px-3 py-1.5 text-xs text-stone-600 shadow dark:bg-stone-900/90 dark:text-stone-300">{{ 'Large family: some relatives are not loaded. Expand people with “+” to see more.' | t }}</p>
          }

          @if (!store.rootId() && !store.loading()) {
            <div class="flex h-full items-center justify-center p-6 text-center">
              <div class="max-w-sm">
                <p class="font-semibold">{{ 'No family head yet' | t }}</p>
                <p class="mt-1 text-sm text-stone-500">{{ 'The tree starts from the family head (G1). Choose one in the family settings.' | t }}</p>
                @if (context.can('family.set_founder')) { <a routerLink="/family/settings" class="btn-secondary mt-4">{{ 'Family settings' | t }}</a> }
              </div>
            </div>
          } @else {
            <fh-tree-canvas [layout]="store.layout()" [people]="store.nodes()" [selectedId]="store.selectedId()" [highlighted]="store.highlighted()" [expanding]="store.expanding()" [ariaLabel]="'Family tree of the {family}. Use Tab to move between people and Enter to select.' | t: { family: context.active()!.name }" (selectPerson)="select($event)" (togglePerson)="store.toggle($event)" />
          }
        </section>

        <!-- Right: selected person (bottom sheet on small screens) -->
        <aside class="z-20 overflow-y-auto border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900" [class]="store.selectedId() ? 'fixed inset-x-0 bottom-0 max-h-[60dvh] rounded-t-2xl shadow-2xl lg:static lg:max-h-none lg:rounded-none lg:shadow-none' : 'hidden lg:block'" [attr.aria-label]="'Selected person' | t">
          @if (store.selected(); as p) {
            <div class="p-5">
              <div class="flex items-start gap-3">
                <fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" />
                <div class="min-w-0 flex-1">
                  <h2 class="text-xl font-semibold leading-tight">{{ p.displayName }}</h2>
                  <p class="text-sm text-stone-500">{{ span(p) || '—' }}</p>
                  <fh-family-code class="mt-1.5 block" [code]="p.familyCode" />
                </div>
                <button type="button" class="btn-ghost !p-1.5" (click)="store.selectedId.set(null); store.setHighlight(null)" [attr.aria-label]="'Close person panel' | t"><svg lucideX class="size-4"></svg></button>
              </div>

              <div class="mt-4 flex flex-wrap gap-2">
                <a [routerLink]="['/members', p.id]" class="btn-primary !py-2 text-sm">{{ 'View full profile' | t }}</a>
                <button type="button" class="btn-secondary !py-2 text-sm" (click)="locate(p.id)"><svg lucideLocateFixed class="size-4"></svg> {{ 'Centre' | t }}</button>
              </div>
              <fieldset class="mt-4">
                <legend class="label">{{ 'Highlight' | t }}</legend>
                <div class="flex flex-wrap gap-2 text-sm">
                  @for (m of highlightModes; track m.label) {
                    <button type="button" class="btn-ghost !py-1.5 text-xs" [class]="(store.highlight()?.mode ?? null) === m.mode ? 'bg-brand-50 dark:bg-brand-950' : ''" [attr.aria-pressed]="(store.highlight()?.mode ?? null) === m.mode" (click)="store.setHighlight(m.mode)">{{ m.label }}</button>
                  }
                </div>
              </fieldset>

              @if (detail(); as d) {
                @for (g of relativeGroups(d); track g.title) {
                  @if (g.people.length) {
                    <section class="mt-5">
                      <h3 class="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">{{ g.title }}</h3>
                      <ul class="mt-1.5 space-y-1">
                        @for (r of g.people; track r.person.id) {
                          <li>
                            <button type="button" class="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-stone-50 dark:hover:bg-stone-800" (click)="onPicked(r.person)">
                              <fh-person-avatar [name]="r.person.displayName" size="sm" />
                              <span class="min-w-0"><span class="block truncate text-sm font-medium">{{ r.person.displayName }}</span><span class="block text-xs text-stone-500">{{ r.note }}</span></span>
                            </button>
                          </li>
                        }
                      </ul>
                    </section>
                  }
                }
                @if (d.biography) {
                  <section class="mt-5">
                    <h3 class="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'Biography' | t }}</h3>
                    <p class="mt-1.5 line-clamp-6 text-sm leading-relaxed text-stone-700 dark:text-stone-300">{{ d.biography }}</p>
                  </section>
                }
              } @else {
                <div class="mt-5"><fh-spinner /></div>
              }
            </div>
          } @else {
            <div class="p-6 text-sm text-stone-500">
              <p class="font-medium text-stone-700 dark:text-stone-300">{{ 'Select a person' | t }}</p>
              <p class="mt-1">{{ 'Click or tab to anyone in the tree to see their details. Use “+” under a card to show their children.' | t }}</p>
            </div>
          }
        </aside>
      </div>
    }
  `,
})
export class FamilyTreePage {
  /** Query parameter: focus a person. */
  readonly focus = input<string>();

  protected readonly context = inject(FamilyContextStore);
  protected readonly store = inject(TreeStore);
  private readonly membersApi = inject(MembersApi);
  protected readonly canvas = viewChild(TreeCanvasComponent);
  private readonly shell = viewChild<ElementRef<HTMLElement>>('shell');

  protected readonly depth = signal(3);
  protected readonly filtersOpen = signal(false);
  protected readonly detail = signal<MemberView | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly exporting = signal(false);
  protected readonly isFullscreen = signal(false);
  protected readonly span = lifespan;

  protected readonly highlightModes = [
    { mode: 'ancestors' as const, label: t('Ancestors') },
    { mode: 'descendants' as const, label: t('Descendants') },
    { mode: null, label: t('None') },
  ];

  protected readonly legend = [
    { label: t('Birth parent and child'), dash: null },
    { label: t('Adoptive'), dash: '8 5' },
    { label: t('Step, foster or guardian'), dash: '2 5' },
    { label: t('Not yet verified'), dash: '6 4', opacity: 0.6 },
    { label: t('Partnership / marriage'), double: true },
  ];

  constructor() {
    document.addEventListener('fullscreenchange', () => this.isFullscreen.set(!!document.fullscreenElement));
    effect(() => {
      const family = this.context.active();
      const depth = this.depth();
      if (!family) return;
      untracked(async () => {
        await this.store.loadRoot(family.id, depth);
        const focus = this.focus();
        if (focus && !this.store.selectedId()) await this.onPicked({ id: focus } as PersonCard);
        setTimeout(() => this.canvas()?.initialView());
      });
    });
    effect(() => {
      const id = this.store.selectedId();
      const family = this.context.active();
      this.detail.set(null);
      if (id && family) untracked(() => this.membersApi.get(family.id, id).then((d) => this.detail.set(d)).catch(() => undefined));
    });
  }

  protected select(id: string): void {
    this.store.selectedId.set(id);
    if (this.store.highlight()) this.store.setHighlight(this.store.highlight()!.mode);
  }

  protected async onPicked(p: PersonCard | null): Promise<void> {
    if (!p) return;
    this.notice.set(null);
    const placed = await this.store.focus(p.id);
    this.filtersOpen.set(false);
    if (placed) setTimeout(() => this.canvas()?.centerOn(p.id), 50);
    else {
      const name = p.displayName ?? t('This person');
      this.notice.set(t('{name} is not connected to the family head by recorded parent–child links, so they do not appear in this tree.', { name }));
    }
  }

  protected locate(id: string): void {
    this.canvas()?.centerOn(id);
  }

  protected resetView(): void {
    this.store.setHighlight(null);
    this.canvas()?.reset();
  }

  protected async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.shell()?.nativeElement.requestFullscreen?.();
  }

  protected relativeGroups(d: MemberView) {
    const verification: Record<string, string> = { unverified: t('unverified'), disputed: t('disputed') };
    const subtypeLabel = (s: string) => {
      const label = PARENT_CHILD_SUBTYPE_LABELS[s as keyof typeof PARENT_CHILD_SUBTYPE_LABELS];
      return label ? t(label) : s;
    };
    const parentNote = (s: string, v: string) => [subtypeLabel(s), v === 'verified' ? '' : (verification[v] ?? v)].filter(Boolean).join(' · ');
    return [
      { title: t('Parents'), people: d.relatives.parents.map((r) => ({ person: r.person, note: parentNote(r.subtype, r.verification) })) },
      { title: t('Husband or wife'), people: d.relatives.partners.map((r) => ({ person: r.person, note: t(PARTNERSHIP_SUBTYPE_LABELS[r.subtype as keyof typeof PARTNERSHIP_SUBTYPE_LABELS] ?? '') })) },
      { title: t('Children'), people: d.relatives.children.map((r) => ({ person: r.person, note: parentNote(r.subtype, r.verification) })) },
      { title: t('Siblings'), people: d.relatives.siblings.map((r) => ({ person: r.person, note: r.kind === 'full' ? t('Full sibling') : r.kind === 'half' ? t('Half-sibling') : t('Step / adoptive') })) },
    ];
  }

  protected async exportAs(kind: 'svg' | 'png' | 'pdf'): Promise<void> {
    const canvas = this.canvas();
    const family = this.context.active();
    if (!canvas || !family) return;
    this.exporting.set(true);
    try {
      const { svg, width, height } = await canvas.exportSvg();
      const name = family.name.replace(/[^\w-]+/g, '-').toLowerCase();
      if (kind === 'svg') downloadSvg(svg, `${name}-tree.svg`);
      else if (kind === 'png') await downloadPng(svg, width, height, `${name}-tree.png`);
      else await downloadPdf(svg, width, height, `${name}-tree.pdf`, t('{name} — family tree', { name: family.name }));
    } catch (err) {
      this.store.error.set(err instanceof Error && !(err instanceof ApiError) ? err.message : ApiError.from(err).message);
    } finally {
      this.exporting.set(false);
    }
  }
}
