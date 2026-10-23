import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, startWith } from 'rxjs';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  composeAnnouncement,
  DEFAULT_MESSAGE_TEMPLATE,
  FAMILY_NAME_MAX_LENGTH,
  MESSAGE_OPENING_MAX_LENGTH,
  MESSAGE_SIGN_OFF_MAX_LENGTH,
  type FamilyView,
  type FamilyVisibility,
  type PersonCard,
} from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamiliesApi } from '../../core/families/families.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { FamilyDataComponent } from './family-data.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-family-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, FormFieldComponent, AlertComponent, SpinnerComponent, PersonPickerComponent, NoFamilyComponent, FamilyDataComponent, TranslatePipe],
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
          <h2 id="details-h" class="text-lg font-semibold">{{ 'Details and privacy' | t }}</h2>
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
          <fh-form-field [label]="'Family history' | t" [control]="form.controls.history" #hi>
            <textarea class="input min-h-40" formControlName="history" [attr.id]="hi.controlId"></textarea>
          </fh-form-field>
          <fh-form-field [label]="'Visibility' | t" [control]="form.controls.visibility" #v>
            <select class="input sm:!w-72" formControlName="visibility" [attr.id]="v.controlId">
              <option value="private">{{ 'Private — invited members only' | t }}</option>
              <option value="unlisted">{{ 'Unlisted — anyone with the link' | t }}</option>
              <option value="public">{{ 'Public — discoverable' | t }}</option>
            </select>
          </fh-form-field>
          <div class="space-y-3">
            <label class="flex items-start gap-3 text-sm"><input type="checkbox" class="mt-0.5 size-4 accent-brand-700" formControlName="showLivingToMembers" /> <span>{{ "Show living relatives' details to all family members" | t }}</span></label>
            <label class="flex items-start gap-3 text-sm"><input type="checkbox" class="mt-0.5 size-4 accent-brand-700" formControlName="allowMemberUploads" /> <span>{{ 'Let members upload photographs (after approval)' | t }}</span></label>
            <label class="flex items-start gap-3 text-sm"><input type="checkbox" class="mt-0.5 size-4 accent-brand-700" formControlName="countAdoptive" /> <span>{{ 'Count adopted children as descendants when numbering generations' | t }}</span></label>
          </div>
          <fieldset class="space-y-3 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
            <legend class="px-1 text-sm font-semibold">{{ 'Lineage' | t }}</legend>
            <p class="text-xs text-stone-500">{{ 'The lines people inherit through their mother and their father, and what your family calls them (e.g. abusua and ntoro, or clan).' | t }}</p>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="size-4 accent-brand-700" formControlName="maternalEnabled" /> {{ 'Line through the mother' | t }}</label>
                <label class="label mt-2" for="ml-label">{{ 'Called' | t }}</label>
                <input id="ml-label" class="input" formControlName="maternalLabel" maxlength="40" />
              </div>
              <div>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="size-4 accent-brand-700" formControlName="paternalEnabled" /> {{ 'Line through the father' | t }}</label>
                <label class="label mt-2" for="pl-label">{{ 'Called' | t }}</label>
                <input id="pl-label" class="input" formControlName="paternalLabel" maxlength="40" />
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="label" for="totem-follows">{{ 'The totem follows the line through' | t }}</label>
                <select id="totem-follows" class="input" formControlName="totemFollows">
                  <option value="maternal">{{ 'the mother' | t }}</option>
                  <option value="paternal">{{ 'the father' | t }}</option>
                </select>
              </div>
              <label class="flex items-start gap-2 self-end pb-2 text-sm"><input type="checkbox" class="mt-0.5 size-4 accent-brand-700" formControlName="throughAdoption" /> {{ 'Adoptive parents pass on their lines too' | t }}</label>
            </div>
          </fieldset>
          <fieldset class="space-y-3 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
            <legend class="px-1 text-sm font-semibold">{{ 'Announcements' | t }}</legend>
            <p class="text-xs text-stone-500">{{ 'Every family sends from the same SMS name and e-mail address, so each announcement begins and ends with these lines. Write {family} for the family name.' | t: { family: '{family}' } }}</p>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="label" for="msg-opening">{{ 'Opening line' | t }}</label>
                <input id="msg-opening" class="input" formControlName="messageOpening" [maxlength]="openingMax" [placeholder]="defaultOpening" />
              </div>
              <div>
                <label class="label" for="msg-sign-off">{{ 'Sign-off (optional)' | t }}</label>
                <input id="msg-sign-off" class="input" formControlName="messageSignOff" [maxlength]="signOffMax" [placeholder]="'e.g. Abusua Panin, Opanyin Kofi Mensah' | t" />
              </div>
            </div>
            <div>
              <p class="label">{{ 'How an SMS will read' | t }}</p>
              <p class="whitespace-pre-line rounded-xl bg-stone-100 p-3 text-sm dark:bg-stone-800" data-testid="message-sample">{{ sample() }}</p>
            </div>
          </fieldset>
          <button type="submit" class="btn-primary" [disabled]="busy()">{{ 'Save settings' | t }}</button>
        </form>

        <section class="card h-fit space-y-4 p-6" aria-labelledby="founder-h">
          <h2 id="founder-h" class="text-lg font-semibold">{{ 'Founding ancestor' | t }}</h2>
          <p class="text-sm text-stone-500">{{ 'Generation 1. Change this when an older ancestor is discovered; generation numbers are recalculated from the new founder.' | t }}</p>
          @if (founder(); as f) {
            <p class="text-sm">{{ 'Current:' | t }} <a class="font-semibold text-brand-700 hover:underline dark:text-brand-300" [routerLink]="['/members', f.id]">{{ f.displayName }}</a></p>
          } @else {
            <p class="text-sm text-stone-500">{{ 'No founding ancestor chosen yet.' | t }}</p>
          }
          <fh-person-picker [familyId]="family.id" [label]="'New founding ancestor' | t" [exclude]="family.foundingMemberId ? [family.foundingMemberId] : []" (picked)="candidate.set($event)" />
          <fh-form-field [label]="'Reason (recorded in the audit log)' | t" [control]="reason" #rs>
            <input class="input" [formControl]="reason" [attr.id]="rs.controlId" />
          </fh-form-field>
          @if (founderMessage(); as m) { <fh-alert [tone]="m.tone">{{ m.text }}</fh-alert> }
          <button type="button" class="btn-secondary" [disabled]="!candidate() || busy()" (click)="changeFounder(family)">{{ 'Make founding ancestor' | t }}</button>
        </section>
      </div>
      <div class="mt-6"><fh-family-data [family]="family" /></div>
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
    history: [''],
    visibility: ['private' as FamilyVisibility],
    showLivingToMembers: [true],
    allowMemberUploads: [true],
    countAdoptive: [true],
    maternalEnabled: [true],
    maternalLabel: ['Abusua', [Validators.required, Validators.maxLength(40)]],
    paternalEnabled: [true],
    paternalLabel: ['Ntoro', [Validators.required, Validators.maxLength(40)]],
    totemFollows: ['maternal' as 'maternal' | 'paternal'],
    throughAdoption: [false],
    messageOpening: [DEFAULT_MESSAGE_TEMPLATE.opening, [Validators.maxLength(MESSAGE_OPENING_MAX_LENGTH)]],
    messageSignOff: ['', [Validators.maxLength(MESSAGE_SIGN_OFF_MAX_LENGTH)]],
  });
  protected readonly openingMax = MESSAGE_OPENING_MAX_LENGTH;
  protected readonly signOffMax = MESSAGE_SIGN_OFF_MAX_LENGTH;
  protected readonly defaultOpening = DEFAULT_MESSAGE_TEMPLATE.opening;
  /** An example announcement with the lines as they stand in the form. */
  protected readonly sample = toSignal(
    this.form.valueChanges.pipe(
      startWith(null),
      map(() => {
        const v = this.form.getRawValue();
        return composeAnnouncement({
          template: { opening: v.messageOpening, signOff: v.messageSignOff },
          familyName: v.name.trim() || t('Your family'),
          message: t('The funeral of our father will be held on Saturday at the family house.'),
          linkLine: `${t('Are you coming? Answer here:')} https://…/r/…`,
        });
      }),
    ),
    { initialValue: '' },
  );
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
        history: f.history,
        visibility: f.privacy?.visibility ?? 'private',
        showLivingToMembers: f.privacy?.showLivingToMembers ?? true,
        allowMemberUploads: f.privacy?.allowMemberUploads ?? true,
        countAdoptive: f.generationPolicy?.countAdoptive ?? true,
        maternalEnabled: f.lineage?.maternal.enabled ?? true,
        maternalLabel: f.lineage?.maternal.label ?? 'Abusua',
        paternalEnabled: f.lineage?.paternal.enabled ?? true,
        paternalLabel: f.lineage?.paternal.label ?? 'Ntoro',
        totemFollows: f.lineage?.totemFollows ?? 'maternal',
        throughAdoption: f.lineage?.throughAdoption ?? false,
        messageOpening: f.messageTemplate?.opening ?? DEFAULT_MESSAGE_TEMPLATE.opening,
        messageSignOff: f.messageTemplate?.signOff ?? '',
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
        history: v.history.trim(),
        origin: { hometown: v.hometown.trim(), region: v.region.trim(), country: v.country.trim() },
        privacy: { visibility: v.visibility, showLivingToMembers: v.showLivingToMembers, allowMemberUploads: v.allowMemberUploads },
        generationPolicy: { countAdoptive: v.countAdoptive },
        lineage: {
          maternal: { enabled: v.maternalEnabled, label: v.maternalLabel.trim() || 'Abusua' },
          paternal: { enabled: v.paternalEnabled, label: v.paternalLabel.trim() || 'Ntoro' },
          totemFollows: v.totemFollows,
          throughAdoption: v.throughAdoption,
        },
        messageTemplate: { opening: v.messageOpening.trim(), signOff: v.messageSignOff.trim() },
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
      this.founderMessage.set({ tone: 'success', text: t('{name} is now the founding ancestor (Generation 1).', { name: person.displayName }) });
    } catch (err) {
      this.founderMessage.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }
}
