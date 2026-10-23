import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { LucideX } from '@lucide/angular';
import type { PlaceInput, PlaceView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PlacesApi } from '../../core/places/places.api';
import { AlertComponent } from '../../shared/ui/alert.component';

export interface PlaceDialogData {
  familyId: string;
  place: PlaceView | null;
  /** A name to start from (a place mentioned on profiles). */
  name?: string;
}

/** "6.6885, -1.6244" (as map apps copy them) → [6.6885, -1.6244]. */
export function parseCoordinates(text: string): [number, number] | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

/** Records or edits a place. Closes with the saved place. */
@Component({
  selector: 'fh-place-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, AlertComponent, LucideX, TranslatePipe],
  host: { class: 'block card max-h-[92dvh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto p-6 shadow-(--shadow-raised)' },
  template: `
    <div class="flex items-start gap-2">
      <h2 class="flex-1 text-xl font-semibold">{{ data.place ? ('Edit {name}' | t: { name: data.place.name }) : ('Add a place' | t) }}</h2>
      <button type="button" class="btn-ghost !p-2" (click)="ref.close()" [attr.aria-label]="'Close' | t"><svg lucideX class="size-5"></svg></button>
    </div>
    @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }
    <form class="mt-5 space-y-4" [formGroup]="form" (submit)="$event.preventDefault(); save()">
      <div><label class="label" for="p-name">{{ 'Name' | t }}</label><input id="p-name" class="input" formControlName="name" maxlength="120" [placeholder]="'e.g. Kumasi' | t" /></div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div><label class="label" for="p-region">{{ 'Region' | t }}</label><input id="p-region" class="input" formControlName="region" maxlength="120" [placeholder]="'e.g. Ashanti' | t" /></div>
        <div><label class="label" for="p-country">{{ 'Country' | t }}</label><input id="p-country" class="input" formControlName="country" maxlength="120" [placeholder]="'e.g. Ghana' | t" /></div>
      </div>
      <div>
        <label class="label" for="p-aliases">{{ 'Other names and spellings' | t }}</label>
        <input id="p-aliases" class="input" formControlName="aliases" maxlength="2000" [placeholder]="'e.g. Kumase, Coomassie' | t" aria-describedby="p-aliases-hint" />
        <p id="p-aliases-hint" class="mt-1 text-xs text-stone-500">{{ 'Separate them with commas. Profiles and events that use any of these names count for this place.' | t }}</p>
      </div>
      <div>
        <label class="label" for="p-coords">{{ 'Where it is on the map' | t }} <span class="font-normal text-stone-500">{{ '(optional)' | t }}</span></label>
        <input id="p-coords" class="input" formControlName="coordinates" maxlength="60" [placeholder]="'Latitude, longitude — e.g. 6.6885, -1.6244' | t" inputmode="decimal" aria-describedby="p-coords-hint" />
        <p id="p-coords-hint" class="mt-1 text-xs text-stone-500">{{ 'In most map apps, press and hold (or right-click) the place and copy its coordinates.' | t }}</p>
      </div>
      <div><label class="label" for="p-notes">{{ 'Notes' | t }}</label><textarea id="p-notes" class="input min-h-20" formControlName="notes" maxlength="5000" [placeholder]="'The family house, the stool, who still lives there…' | t"></textarea></div>
      <div class="flex gap-2">
        <button type="submit" class="btn-primary" [disabled]="busy()">{{ data.place ? ('Save' | t) : ('Add place' | t) }}</button>
        <button type="button" class="btn-secondary" (click)="ref.close()">{{ 'Cancel' | t }}</button>
      </div>
    </form>
  `,
})
export class PlaceDialogComponent {
  protected readonly data = inject<PlaceDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<PlaceView>>(DialogRef);
  private readonly api = inject(PlacesApi);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly p = this.data.place;
  protected readonly form = inject(NonNullableFormBuilder).group({
    name: [this.p?.name ?? this.data.name ?? ''],
    region: [this.p?.region ?? ''],
    country: [this.p?.country ?? ''],
    aliases: [this.p?.aliases.join(', ') ?? ''],
    coordinates: [this.p?.latitude != null ? `${this.p.latitude}, ${this.p.longitude}` : ''],
    notes: [this.p?.notes ?? ''],
  });

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    if (!v.name.trim()) return this.error.set(t('Name the place.'));
    const coords = v.coordinates.trim() ? parseCoordinates(v.coordinates) : null;
    if (v.coordinates.trim() && !coords) return this.error.set(t('Write the coordinates as latitude, longitude — for example 6.6885, -1.6244.'));
    const body: PlaceInput = {
      name: v.name.trim(),
      region: v.region.trim(),
      country: v.country.trim(),
      aliases: [...new Set(v.aliases.split(',').map((a) => a.trim()).filter(Boolean))],
      latitude: coords?.[0] ?? null,
      longitude: coords?.[1] ?? null,
      notes: v.notes.trim(),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      this.ref.close(this.p ? await this.api.update(this.data.familyId, this.p.id, { ...body, version: this.p.version }) : await this.api.create(this.data.familyId, body));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
