import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideArrowRight, LucideMapPin, LucideMapPinOff, LucidePlus } from '@lucide/angular';
import type { PlaceFlow, PlacesOverview, PlaceView, PublicConfig } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { PublicConfigService } from '../../core/config/public-config.service';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PlacesApi } from '../../core/places/places.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { PlaceDialogComponent, type PlaceDialogData } from './place-dialog.component';
import { PlacesMapComponent, placeTotal } from './places-map.component';

type FlowFilter = 'all' | PlaceFlow['kind'];
const FILTERS: { id: FlowFilter; label: string }[] = [
  { id: 'all', label: mark('All moves') },
  { id: 'generation', label: mark('Between generations') },
  { id: 'lifetime', label: mark('Within a lifetime') },
];

/** Where the family has lived: places on a map, how people moved between them, and places not recorded yet. */
@Component({
  selector: 'fh-places-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, NoFamilyComponent, SpinnerComponent, PlacesMapComponent, LucideArrowRight, LucideMapPin, LucideMapPinOff, LucidePlus, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Places' | t }}</h1>
          <p class="mt-1 max-w-3xl text-sm text-stone-500">
            {{ 'Towns and villages where the family was born, lived and gathered, and how it moved between them. Places are matched to profiles and events by name and other spellings.' | t }}
          </p>
        </div>
        @if (canEdit()) { <button type="button" class="btn-primary" (click)="open(null)"><svg lucidePlus class="size-4"></svg> {{ 'Add a place' | t }}</button> }
      </header>

      @if (error(); as e) { <fh-alert class="mb-4 block">{{ e }}</fh-alert> }

      @if (overview(); as o) {
        @if (o.places.length) {
          <div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section class="card p-4 sm:p-5" aria-labelledby="map-h">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 id="map-h" class="text-lg font-semibold">{{ 'Map' | t }}</h2>
                <div role="radiogroup" [attr.aria-label]="'Moves shown' | t" class="inline-flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1 text-sm dark:bg-stone-800">
                  @for (f of filters; track f.id) {
                    <button type="button" role="radio" [attr.aria-checked]="filter() === f.id" class="rounded-lg px-3 py-1 font-medium"
                            [class]="filter() === f.id ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-600 dark:text-stone-300'" (click)="filter.set(f.id)">{{ f.label | t }}</button>
                  }
                </div>
              </div>
              @if (located().length) {
                <fh-places-map [places]="o.places" [flows]="shownFlows()" [tiles]="config()?.mapTiles ?? null" (select)="go($event)" />
                <p class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-stone-500">
                  <span class="flex items-center gap-1.5"><span class="inline-block h-0.5 w-6 rounded bg-brand-700 dark:bg-brand-300" aria-hidden="true"></span> {{ 'Parent born here, child born there' | t }}</span>
                  <span class="flex items-center gap-1.5"><span class="inline-block w-6 border-t-2 border-dashed border-gold-700 dark:border-gold-300" aria-hidden="true"></span> {{ 'Born here, lived or died there' | t }}</span>
                  <span>{{ 'Bigger dots: more people and events.' | t }}</span>
                </p>
              } @else {
                <div class="rounded-xl bg-stone-50 p-8 text-center text-sm text-stone-500 dark:bg-stone-900">
                  <svg lucideMapPinOff class="mx-auto mb-2 size-8 opacity-60" aria-hidden="true"></svg>
                  {{ 'None of the places has coordinates yet.' | t }}@if (canEdit()) { {{ 'Edit a place and add where it is to see it on the map.' | t }} }
                </div>
              }
            </section>

            <section class="card p-5" aria-labelledby="moves-h">
              <h2 id="moves-h" class="text-lg font-semibold">{{ 'Where the family moved' | t }}</h2>
              @if (shownFlows().length) {
                <ul class="mt-3 space-y-2 text-sm">
                  @for (f of shownFlows(); track $index) {
                    <li class="flex items-center gap-2">
                      <span class="inline-block w-4 shrink-0" [class]="f.kind === 'generation' ? 'h-0.5 rounded bg-brand-700 dark:bg-brand-300' : 'border-t-2 border-dashed border-gold-700 dark:border-gold-300'" aria-hidden="true"></span>
                      <span class="min-w-0 flex-1">
                        <a class="font-medium hover:underline" [routerLink]="['/places', f.from.id]">{{ f.from.name }}</a>
                        <svg lucideArrowRight class="mx-1 inline size-3.5 text-stone-400" [attr.aria-label]="'to' | t"></svg>
                        <a class="font-medium hover:underline" [routerLink]="['/places', f.to.id]">{{ f.to.name }}</a>
                        <span class="block text-xs text-stone-500">{{ f.kind === 'generation' ? ('children born away from their parents’ birthplace' | t) : ('born in one, lived or died in the other' | t) }}</span>
                      </span>
                      <span class="shrink-0 tabular-nums text-stone-600 dark:text-stone-300">{{ '{count, plural, one {# person} other {# people}}' | t: { count: f.people } }}</span> <!-- i18n-ignore -->
                    </li>
                  }
                </ul>
              } @else {
                <p class="mt-2 text-sm text-stone-500">{{ "No moves between recorded places yet. Moves appear when people's birthplaces, homes and places of death are recorded places." | t }}</p>
              }
            </section>
          </div>

          <section class="mt-6" aria-labelledby="list-h">
            <h2 id="list-h" class="mb-3 text-lg font-semibold">{{ '{count, plural, one {# place} other {# places}}' | t: { count: o.places.length } }}</h2> <!-- i18n-ignore -->
            <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              @for (p of o.places; track p.id) {
                <li>
                  <a [routerLink]="['/places', p.id]" class="card block h-full p-4 transition hover:-translate-y-0.5 hover:shadow-(--shadow-raised)">
                    <p class="flex items-center gap-2 font-semibold">
                      <svg lucideMapPin [class]="p.latitude !== null ? 'size-4 shrink-0 text-brand-700 dark:text-brand-300' : 'size-4 shrink-0 text-stone-400'" aria-hidden="true"></svg>
                      <span class="truncate">{{ p.name }}</span>
                    </p>
                    @if (p.region || p.country) { <p class="mt-0.5 text-sm text-stone-500">{{ where(p) }}</p> }
                    <p class="mt-2 text-sm text-stone-600 dark:text-stone-300">{{ summary(p) }}</p>
                    @if (p.latitude === null) { <p class="mt-1 text-xs text-stone-500">{{ 'Not on the map yet' | t }}</p> }
                  </a>
                </li>
              }
            </ul>
          </section>
        } @else {
          <div class="card p-10 text-center">
            <svg lucideMapPin class="mx-auto mb-3 size-10 text-brand-600" aria-hidden="true"></svg>
            <p class="font-medium">{{ 'No places recorded yet.' | t }}</p>
            <p class="mx-auto mt-1 max-w-xl text-sm text-stone-500">
              {{ 'Record the towns and villages that matter to the family — where people were born, lived and are buried.' | t }}
              @if (o.suggestions.length) { {{ 'Start with the ones already mentioned on profiles below.' | t }} }
            </p>
          </div>
        }

        @if (o.suggestions.length) {
          <section class="card mt-6 p-5" aria-labelledby="sugg-h">
            <h2 id="sugg-h" class="text-lg font-semibold">{{ 'Mentioned but not recorded yet' | t }}</h2>
            <p class="mt-1 text-sm text-stone-500">
              {{ 'Place names used on profiles and events that do not match a place.' | t }}@if (canEdit()) { {{ 'Record one, or add the name as another spelling of a place you have.' | t }} }
            </p>
            <ul class="mt-3 flex flex-wrap gap-2">
              @for (s of o.suggestions; track s.name) {
                <li>
                  @if (canEdit()) {
                    <button type="button" class="rounded-full border border-stone-300 px-3 py-1 text-sm hover:border-brand-500 hover:bg-brand-50 dark:border-stone-700 dark:hover:bg-brand-950" (click)="open(null, s.name)" [attr.aria-label]="'Record {name} as a place (mentioned {uses} times)' | t: { name: s.name, uses: s.uses }">
                      <svg lucidePlus class="-mt-0.5 inline size-3.5"></svg> {{ s.name }} <span class="text-stone-500">· {{ s.uses }}</span>
                    </button>
                  } @else {
                    <span class="rounded-full border border-stone-300 px-3 py-1 text-sm dark:border-stone-700">{{ s.name }} <span class="text-stone-500">· {{ s.uses }}</span></span>
                  }
                </li>
              }
            </ul>
          </section>
        }
      } @else if (!error()) {
        <fh-spinner [showLabel]="true" />
      }
    }
  `,
})
export class PlacesPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(PlacesApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);
  private readonly configService = inject(PublicConfigService);

  protected readonly overview = signal<PlacesOverview | null>(null);
  protected readonly config = signal<PublicConfig | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly filter = signal<FlowFilter>('all');
  protected readonly filters = FILTERS;
  protected readonly canEdit = computed(() => this.context.can('event.manage'));
  protected readonly located = computed(() => (this.overview()?.places ?? []).filter((p) => p.latitude !== null));
  protected readonly shownFlows = computed(() => (this.overview()?.flows ?? []).filter((f) => this.filter() === 'all' || f.kind === this.filter()));

  constructor() {
    void this.configService.get().then((c) => this.config.set(c));
    effect(() => {
      const family = this.context.active();
      if (family) untracked(() => void this.load(family.id));
    });
  }

  private async load(familyId: string): Promise<void> {
    try {
      this.error.set(null);
      this.overview.set(await this.api.overview(familyId));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected where(p: PlaceView): string {
    return [p.region, p.country].filter(Boolean).join(', ');
  }

  protected summary(p: PlaceView): string {
    const c = p.counts;
    const parts = [
      c.births && t('{count} born', { count: c.births }),
      c.hometowns && t('{count} from here', { count: c.hometowns }),
      c.deaths && t('{count} died', { count: c.deaths }),
      c.events && t('{count, plural, one {# event} other {# events}}', { count: c.events }),
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : placeTotal(p) ? '' : t('Nobody recorded here yet');
  }

  protected go(id: string): void {
    void this.router.navigate(['/places', id]);
  }

  protected async open(place: PlaceView | null, name?: string): Promise<void> {
    const familyId = this.context.active()!.id;
    const saved = await firstValueFrom(this.dialog.open<PlaceView, PlaceDialogData>(PlaceDialogComponent, { data: { familyId, place, name }, ariaLabel: t('Place') }).closed);
    if (saved) await this.load(familyId);
  }
}
