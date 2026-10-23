import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { LucidePlus, LucideX } from '@lucide/angular';
import { ATTRIBUTE_NAME_MAX_LENGTH, ATTRIBUTE_VALUE_MAX_LENGTH } from '@fh/contracts';
import type { ApiError } from '../../core/api/api-error';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { mark } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { FuzzyDateFieldComponent } from '../../shared/ui/fuzzy-date-field.component';
import { attributeForm, type MemberForm } from './member-fields';

/** A person's details, shared by "add a person", "edit a person" and the family head step of registering a family. */
@Component({
  selector: 'fh-member-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormFieldComponent, FuzzyDateFieldComponent, LucidePlus, LucideX, TranslatePipe],
  template: `
    <div [formGroup]="form()" class="space-y-6">
      <div class="grid gap-4 sm:grid-cols-2">
        <fh-form-field [label]="'First name' | t" [control]="form().controls.firstName" [serverError]="err('firstName')" #fn>
          <input class="input" formControlName="firstName" autocomplete="off" [attr.id]="fn.controlId" [attr.aria-describedby]="fn.describedBy()" [attr.aria-invalid]="!!fn.error()" />
        </fh-form-field>
        <fh-form-field [label]="'Surname' | t" [control]="form().controls.surname" #sn>
          <input class="input" formControlName="surname" autocomplete="off" [attr.id]="sn.controlId" />
        </fh-form-field>
        <fh-form-field [label]="'Common name' | t" [control]="form().controls.preferredName" [hint]="'What people call them, e.g. Papa Nii' | t" #pn>
          <input class="input" formControlName="preferredName" autocomplete="off" [attr.id]="pn.controlId" [attr.aria-describedby]="pn.describedBy()" />
        </fh-form-field>
        <fh-form-field [label]="'Gender' | t" [control]="form().controls.gender" #g>
          <select class="input" formControlName="gender" [attr.id]="g.controlId">
            <option value="">{{ 'Not recorded' | t }}</option>
            <option value="male">{{ 'Male' | t }}</option>
            <option value="female">{{ 'Female' | t }}</option>
            <option value="other">{{ 'Other' | t }}</option>
          </select>
        </fh-form-field>
        <fh-form-field class="sm:col-span-2" [label]="'Place of stay' | t" [control]="form().controls.residence" [hint]="'Where they live now' | t" #ps>
          <input class="input" formControlName="residence" [attr.id]="ps.controlId" [attr.aria-describedby]="ps.describedBy()" />
        </fh-form-field>
      </div>

      <fh-fuzzy-date-field [label]="'Date of birth' | t" [form]="form().controls.birthDate" [error]="err('birthDate')" />

      <fieldset>
        <legend class="label">{{ 'Status' | t }}</legend>
        <div class="flex flex-wrap gap-2">
          @for (s of statuses; track s.value) {
            <label class="flex cursor-pointer items-center rounded-xl border border-stone-300 px-3 py-2 text-sm font-medium has-checked:border-brand-600 has-checked:bg-brand-50 has-checked:text-brand-800 dark:border-stone-700 dark:has-checked:bg-brand-950 dark:has-checked:text-brand-100">
              <input type="radio" class="sr-only" formControlName="vitalStatus" [value]="s.value" />{{ s.label | t }}
            </label>
          }
        </div>
        @if (err('vitalStatus'); as e) { <p class="mt-1.5 text-sm text-red-700">{{ e }}</p> }
      </fieldset>
      @if (form().controls.vitalStatus.value === 'deceased') {
        <fh-fuzzy-date-field [label]="'Date of death' | t" [form]="form().controls.deathDate" [error]="err('deathDate')" />
      }

      <fieldset class="space-y-2" [attr.aria-describedby]="'details-hint'">
        <legend class="label">{{ 'Other details' | t }}</legend>
        <p id="details-hint" class="text-xs text-stone-500">{{ 'Add anything else worth recording, e.g. Occupation: Teacher, or Church: Presby.' | t }}</p>
        <datalist id="attribute-names">
          @for (n of names(); track n) { <option [value]="n"></option> }
        </datalist>
        @for (a of form().controls.attributes.controls; track a; let i = $index) {
          <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2" [formGroup]="a">
            <label class="sr-only" [for]="'attr-name-' + i">{{ 'Detail {number}' | t: { number: i + 1 } }}</label>
            <input class="input" [id]="'attr-name-' + i" formControlName="name" list="attribute-names" [maxlength]="nameMax" [placeholder]="'Detail, e.g. Occupation' | t"
                   [attr.aria-invalid]="a.controls.name.invalid && a.controls.name.touched" />
            <label class="sr-only" [for]="'attr-value-' + i">{{ 'Value of detail {number}' | t: { number: i + 1 } }}</label>
            <input class="input" [id]="'attr-value-' + i" formControlName="value" [maxlength]="valueMax" [placeholder]="'Value, e.g. Teacher' | t" />
            <button type="button" class="btn-ghost !px-2" (click)="form().controls.attributes.removeAt(i)" [attr.aria-label]="'Remove detail {number}' | t: { number: i + 1 }">
              <svg lucideX class="size-4"></svg>
            </button>
          </div>
        }
        @if (err('attributes'); as e) { <p class="text-sm text-red-700">{{ e }}</p> }
        <button type="button" class="btn-ghost !px-2 !py-1 text-sm" (click)="addDetail()">
          <svg lucidePlus class="size-4"></svg> {{ 'Add a detail' | t }}
        </button>
      </fieldset>
    </div>
  `,
})
export class MemberFieldsComponent {
  readonly form = input.required<MemberForm>();
  readonly error = input<ApiError | null>(null);
  /** Prefix of server error paths, e.g. `person.` for the create endpoint. */
  readonly errorPrefix = input('');

  private readonly context = inject(FamilyContextStore);
  private readonly membersApi = inject(MembersApi);
  /** Detail names already used in the family, offered as you type so they stay the same everywhere. */
  protected readonly names = signal<string[]>([]);
  protected readonly nameMax = ATTRIBUTE_NAME_MAX_LENGTH;
  protected readonly valueMax = ATTRIBUTE_VALUE_MAX_LENGTH;
  protected readonly statuses = [
    { value: 'living', label: mark('Living') },
    { value: 'deceased', label: mark('Deceased') },
    { value: 'unknown', label: mark('Unknown') },
  ] as const;

  constructor() {
    effect(() => {
      const family = this.context.active();
      if (family) untracked(() => void this.membersApi.attributeNames(family.id).then((n) => this.names.set(n), () => undefined));
    });
  }

  protected err(path: string): string | undefined {
    const e = this.error();
    if (!e) return undefined;
    const full = this.errorPrefix() + path;
    return e.details.find((d) => d.path === full || d.path.startsWith(full + '.'))?.message;
  }

  protected addDetail(): void {
    this.form().controls.attributes.push(attributeForm());
    // Focus the new detail's name, so typing can start at once.
    const i = this.form().controls.attributes.length - 1;
    setTimeout(() => document.getElementById(`attr-name-${i}`)?.focus());
  }
}
