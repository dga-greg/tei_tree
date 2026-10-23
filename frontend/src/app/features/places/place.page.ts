import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { LucideExternalLink, LucideMapPin, LucidePencil, LucideTrash2 } from '@lucide/angular';
import { EVENT_KIND_LABELS, isCeremony, type PersonCard, type PlaceDetail, type PlaceView, type PublicConfig } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { PublicConfigService } from '../../core/config/public-config.service';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PlacesApi } from '../../core/places/places.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { ConfirmDialogComponent, type ConfirmData } from '../../shared/ui/confirm-dialog.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { PlaceDialogComponent, type PlaceDialogData } from './place-dialog.component';
import { PlacesMapComponent } from './places-map.component';

/** One place: who was born, lived and died there, and what happened there. */
@Component({
  selector: 'fh-place-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, PersonAvatarComponent, SpinnerComponent, PlacesMapComponent, LucideMapPin, LucidePencil, LucideTrash2, LucideExternalLink, TranslatePipe],
  template: `
    <a routerLink="/places" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">← {{ 'Places' | t }}</a>
    @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }
    @if (detail(); as d) {
      @let p = d.place;
      <header class="card relative mt-3 overflow-hidden p-6 sm:p-8">
        <div class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-gold-300 via-brand-400 to-brand-700" aria-hidden="true"></div>
        <p class="flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-300"><svg lucideMapPin class="size-4" aria-hidden="true"></svg> {{ 'Place' | t }}</p>
        <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">{{ p.name }}</h1>
        @if (p.region || p.country) { <p class="mt-1 text-stone-600 dark:text-stone-300">{{ where(p) }}</p> }
        @if (p.aliases.length) { <p class="mt-1 text-sm text-stone-500">{{ 'Also known as {names}' | t: { names: p.aliases.join(', ') } }}</p> }
        @if (p.latitude !== null) {
          <a class="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300" [href]="osm(p)" target="_blank" rel="noopener">
            {{ p.latitude }}, {{ p.longitude }} <svg lucideExternalLink class="size-3.5" aria-hidden="true"></svg><span class="sr-only">{{ '(opens a map in a new tab)' | t }}</span>
          </a>
        }
        @if (p.viewerCan.edit) {
          <div class="mt-4 flex flex-wrap gap-2">
            <button type="button" class="btn-secondary" (click)="edit(p)"><svg lucidePencil class="size-4"></svg> {{ 'Edit' | t }}</button>
            <button type="button" class="btn-ghost text-red-700 dark:text-red-400" (click)="remove(p)"><svg lucideTrash2 class="size-4"></svg> {{ 'Remove' | t }}</button>
          </div>
        }
      </header>

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div class="space-y-6">
          @if (p.notes) {
            <section class="card p-6"><p class="whitespace-pre-line leading-relaxed text-stone-700 dark:text-stone-300">{{ p.notes }}</p></section>
          }
          @for (g of groups(); track g.id) {
            <section class="card p-6" [attr.aria-labelledby]="g.id">
              <h2 [id]="g.id" class="text-lg font-semibold">{{ g.title }} <span class="text-sm font-normal text-stone-500">({{ g.people.length }})</span></h2>
              @if (g.people.length) {
                <ul class="mt-3 grid gap-2 sm:grid-cols-2">
                  @for (m of g.people; track m.id) {
                    <li>
                      <a [routerLink]="['/members', m.id]" class="flex items-center gap-3 rounded-lg p-1.5 hover:bg-stone-50 dark:hover:bg-stone-800/60">
                        <fh-person-avatar [name]="m.displayName" [photoUrl]="m.photoUrl" size="sm" />
                        <span class="min-w-0"><span class="block truncate font-medium">{{ m.displayName }}</span><span class="block text-xs text-stone-500">{{ span(m) }}</span></span>
                      </a>
                    </li>
                  }
                </ul>
              } @else {
                <p class="mt-2 text-sm text-stone-500">{{ g.empty }}</p>
              }
            </section>
          }
        </div>
        <div class="space-y-6">
          @if (p.latitude !== null && config()?.mapTiles) {
            <section class="card p-4" [attr.aria-label]="'Map' | t">
              <fh-places-map [places]="[p]" [tiles]="config()?.mapTiles ?? null" [selected]="p.id" />
            </section>
          }
          <section class="card p-6" aria-labelledby="ev-h">
            <h2 id="ev-h" class="text-lg font-semibold">{{ 'Events here' | t }}</h2>
            @if (d.events.length) {
              <ul class="mt-3 space-y-3">
                @for (e of d.events; track e.id) {
                  <li>
                    @if (ceremony(e.kind)) { <a class="font-medium hover:underline" [routerLink]="['/ceremonies', e.id]">{{ e.title }}</a> } @else { <span class="font-medium">{{ e.title }}</span> }
                    <span class="block text-sm text-stone-500">{{ kindLabels[e.kind] | t }}@if (e.date) { · {{ fuzzy(e.date) }} }</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="mt-2 text-sm text-stone-500">{{ 'No family events recorded here.' | t }}</p>
            }
          </section>
        </div>
      </div>
    } @else if (!error()) {
      <fh-spinner class="mt-6" [showLabel]="true" />
    }
  `,
})
export class PlacePage {
  readonly id = input.required<string>();
  private readonly context = inject(FamilyContextStore);
  private readonly api = inject(PlacesApi);
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  protected readonly detail = signal<PlaceDetail | null>(null);
  protected readonly config = signal<PublicConfig | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly kindLabels = EVENT_KIND_LABELS;
  protected readonly fuzzy = formatFuzzyDate;
  protected readonly span = lifespan;
  protected readonly ceremony = isCeremony;

  protected readonly groups = computed(() => {
    const d = this.detail();
    if (!d) return [];
    return [
      { id: 'born-h', title: t('Born here'), people: d.born, empty: t('Nobody recorded as born here.') },
      { id: 'home-h', title: t('From here'), people: d.hometown, empty: t('Nobody has this as their hometown.') },
      { id: 'died-h', title: t('Died here'), people: d.died, empty: t('Nobody recorded as having died here.') },
    ] satisfies { id: string; title: string; people: PersonCard[]; empty: string }[];
  });

  constructor() {
    void inject(PublicConfigService).get().then((c) => this.config.set(c));
    effect(() => {
      const family = this.context.active();
      const id = this.id();
      if (family) untracked(() => void this.load(family.id, id));
    });
  }

  private async load(familyId: string, id: string): Promise<void> {
    try {
      this.detail.set(await this.api.detail(familyId, id));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected where(p: PlaceView): string {
    return [p.region, p.country].filter(Boolean).join(', ');
  }

  protected osm(p: PlaceView): string {
    return `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=12/${p.latitude}/${p.longitude}`;
  }

  protected async edit(p: PlaceView): Promise<void> {
    const familyId = this.context.active()!.id;
    const saved = await firstValueFrom(this.dialog.open<PlaceView, PlaceDialogData>(PlaceDialogComponent, { data: { familyId, place: p }, ariaLabel: t('Edit place') }).closed);
    if (saved) await this.load(familyId, p.id);
  }

  protected async remove(p: PlaceView): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog.open<boolean, ConfirmData>(ConfirmDialogComponent, {
        data: {
          title: t('Remove {name}?', { name: p.name }),
          message: t('The place is removed from the map. Profiles and events keep the place names written on them. The removal is recorded in the change history.'),
          confirmLabel: t('Remove place'),
          danger: true,
        },
        role: 'alertdialog',
      }).closed,
    );
    if (!ok) return;
    try {
      await this.api.remove(this.context.active()!.id, p.id);
      await this.router.navigate(['/places']);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }
}
