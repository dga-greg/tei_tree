import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FAMILY_NAME_MAX_LENGTH, type FamilyView, type PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamiliesApi } from '../../core/families/families.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-family-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, FormFieldComponent, AlertComponent, SpinnerComponent, PersonPickerComponent, NoFamilyComponent, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (!context.can('family.update')) {
      <fh-alert tone="info">{{ 'Only family administrators can change the family settings.' | t }}</fh-alert>
    } @else if (context.details(); as family) {
      <header class="mb-8">
        <h1 class="text-3xl font-semibold">{{ 'Family settings' | t }}</h1>
        <p class="mt-1 text-sm text-stone-500">{{ family.name }}</p>
      </header>
      <div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <form class="card space-y-5 p-6" [formGroup]="form" (ngSubmit)="save(family)" novalidate aria-labelledby="details-h">
          <h2 id="details-h" class="text-lg font-semibold">{{ 'Family details' | t }}</h2>
          @if (message(); as m) { <fh-alert [tone]="m.tone">{{ m.text }}</fh-alert> }
          <fh-form-field [label]="'Family name' | t" [control]="form.controls.name" #n>
            <input class="input" formControlName="name" [attr.id]="n.controlId" [attr.aria-describedby]="n.describedBy()" [attr.aria-invalid]="!!n.error()" />
          </fh-form-field>
          <fh-form-field [label]="'Short description' | t" [control]="form.controls.description" #d>
            <textarea class="input" rows="2" formControlName="description" [attr.id]="d.controlId"></textarea>
          </fh-form-field>
          <div class="grid gap-4 sm:grid-cols-3">
            <fh-form-field [label]="'Hometown' | t" [control]="form.controls.hometown" #h><input class="input" formControlName="hometown" [attr.id]="h.controlId" /></fh-form-field>
            <fh-form-field [label]="'Region' | t" [control]="form.controls.region" #r><input class="input" formControlName="region" [attr.id]="r.controlId" /></fh-form-field>
            <fh-form-field [label]="'Country' | t" [control]="form.controls.country" #c><input class="input" formControlName="country" [attr.id]="c.controlId" /></fh-form-field>
          </div>
          <button type="submit" class="btn-primary" [disabled]="busy()">{{ 'Save settings' | t }}</button>
        </form>

        <section class="card h-fit space-y-4 p-6" aria-labelledby="founder-h">
          <h2 id="founder-h" class="text-lg font-semibold">{{ 'Family head' | t }}</h2>
          <p class="text-sm text-stone-500">{{ 'If you find out that an earlier person is the real family head, add them as the parent of the current head, then choose them here. Nobody’s family ID changes: the new head becomes G0, and their other children G0.1, G0.2 and so on.' | t }}</p>
          @if (founder(); as f) {
            <p class="text-sm">{{ 'Current:' | t }} <a class="font-semibold text-brand-700 hover:underline dark:text-brand-300" [routerLink]="['/members', f.id]">{{ f.displayName }}</a></p>
          } @else {
            <p class="text-sm text-stone-500">{{ 'No family head chosen yet.' | t }}</p>
          }
          <fh-person-picker [familyId]="family.id" [label]="'New family head' | t" [exclude]="family.foundingMemberId ? [family.foundingMemberId] : []" (picked)="candidate.set($event)" />
          <fh-form-field [label]="'Reason (recorded in the audit log)' | t" [control]="reason" #rs>
            <input class="input" [formControl]="reason" [attr.id]="rs.controlId" />
          </fh-form-field>
          @if (founderMessage(); as m) { <fh-alert [tone]="m.tone">{{ m.text }}</fh-alert> }
          <button type="button" class="btn-secondary" [disabled]="!candidate() || busy()" (click)="changeFounder(family)">{{ 'Make family head' | t }}</button>
        </section>
      </div>
    } @else {
      <fh-spinner [showLabel]="true" />
    }
  `,
})
export class FamilySettingsPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly familiesApi = inject(FamiliesApi);
  private readonly membersApi = inject(MembersApi);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(FAMILY_NAME_MAX_LENGTH)]],
    description: [''],
    hometown: [''],
    region: [''],
    country: [''],
  });
  protected readonly reason = this.fb.control('');
  protected readonly candidate = signal<PersonCard | null>(null);
  protected readonly founder = signal<PersonCard | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  protected readonly founderMessage = signal<{ tone: 'success' | 'error'; text: string } | null>(null);

  constructor() {
    if (this.context.active() && !this.context.details()) void this.context.loadDetails();
    effect(() => {
      const f = this.context.details();
      if (!f) return;
      this.form.reset({
        name: f.name,
        description: f.description,
        hometown: f.origin.hometown,
        region: f.origin.region,
        country: f.origin.country,
      });
      void this.loadFounder(f);
    });
  }

  private async loadFounder(f: FamilyView): Promise<void> {
    this.founder.set(f.foundingMemberId ? await this.membersApi.get(f.id, f.foundingMemberId).catch(() => null) : null);
  }

  protected async save(family: FamilyView): Promise<void> {
    if (this.form.invalid) return this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.message.set(null);
    try {
      const updated = await this.familiesApi.update(family.id, {
        version: family.version ?? 0,
        name: v.name.trim(),
        description: v.description.trim(),
        origin: { hometown: v.hometown.trim(), region: v.region.trim(), country: v.country.trim() },
      });
      this.context.setDetails(updated);
      this.message.set({ tone: 'success', text: t('Settings saved.') });
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected async changeFounder(family: FamilyView): Promise<void> {
    const person = this.candidate();
    if (!person) return;
    this.busy.set(true);
    this.founderMessage.set(null);
    try {
      const updated = await this.familiesApi.setFounder(family.id, { memberId: person.id, reason: this.reason.value.trim() || undefined });
      this.context.setDetails(updated);
      this.reason.reset();
      this.founderMessage.set({ tone: 'success', text: t('{name} is now the family head. Everyone keeps their family ID.', { name: person.displayName }) });
    } catch (err) {
      this.founderMessage.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }
}
