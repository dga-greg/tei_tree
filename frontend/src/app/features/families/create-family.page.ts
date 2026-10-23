import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FAMILY_NAME_MAX_LENGTH, type FamilyVisibility } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { FamiliesApi } from '../../core/families/families.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { memberForm, memberInputFrom } from '../members/member-fields';
import { MemberFieldsComponent } from '../members/member-fields.component';
import { mark } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'fh-create-family-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, FormFieldComponent, AlertComponent, MemberFieldsComponent, TranslatePipe],
  template: `
    <header class="mb-8 max-w-3xl">
      <h1 class="text-3xl font-semibold">{{ 'Register a family' | t }}</h1>
      <p class="mt-2 text-stone-600 dark:text-stone-400">
        {{ "You will be the family's first administrator. Everything stays private until you choose otherwise." | t }}
      </p>
    </header>

    @if (error(); as e) {
      @if (!e.details.length) { <fh-alert class="mb-6 max-w-3xl">{{ e.message }}</fh-alert> }
    }

    <form (submit)="$event.preventDefault(); submit()" class="max-w-3xl space-y-6" novalidate>
      <section class="card space-y-5 p-6" [formGroup]="family" aria-labelledby="step1">
        <h2 id="step1" class="text-xl font-semibold"><span class="text-brand-700">1.</span> {{ 'The family' | t }}</h2>
        <fh-form-field [label]="'Family name' | t" [control]="family.controls.name" [serverError]="error()?.fieldError('name')" [hint]="'e.g. Mensah Family' | t" #n>
          <input class="input" formControlName="name" [attr.id]="n.controlId" [attr.aria-describedby]="n.describedBy()" [attr.aria-invalid]="!!n.error()" />
        </fh-form-field>
        <fh-form-field [label]="'Short description' | t" [control]="family.controls.description" #d>
          <textarea class="input" rows="2" formControlName="description" [attr.id]="d.controlId"></textarea>
        </fh-form-field>
        <div class="grid gap-4 sm:grid-cols-3">
          <fh-form-field [label]="'Hometown of origin' | t" [control]="family.controls.hometown" #h>
            <input class="input" formControlName="hometown" [attr.id]="h.controlId" />
          </fh-form-field>
          <fh-form-field [label]="'Region' | t" [control]="family.controls.region" #r>
            <input class="input" formControlName="region" [attr.id]="r.controlId" />
          </fh-form-field>
          <fh-form-field [label]="'Country' | t" [control]="family.controls.country" #c>
            <input class="input" formControlName="country" [attr.id]="c.controlId" />
          </fh-form-field>
        </div>
        <fh-form-field [label]="'Family history' | t" [control]="family.controls.history" [hint]="'Where the family comes from, its traditions — you can add more later' | t" #hi>
          <textarea class="input min-h-28" formControlName="history" [attr.id]="hi.controlId" [attr.aria-describedby]="hi.describedBy()"></textarea>
        </fh-form-field>
        <fieldset>
          <legend class="label">{{ 'Who can find this family' | t }}</legend>
          <div class="space-y-2">
            @for (v of visibilities; track v.value) {
              <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3 has-checked:border-brand-600 has-checked:bg-brand-50 dark:border-stone-700 dark:has-checked:bg-brand-950">
                <input type="radio" class="mt-1 accent-brand-700" formControlName="visibility" [value]="v.value" />
                <span><span class="block text-sm font-semibold">{{ v.label | t }}</span><span class="block text-xs text-stone-500">{{ v.hint | t }}</span></span>
              </label>
            }
          </div>
        </fieldset>
      </section>

      <section class="card space-y-5 p-6" aria-labelledby="step2">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="step2" class="text-xl font-semibold"><span class="text-brand-700">2.</span> {{ 'Founding ancestor' | t }}</h2>
            <p class="mt-1 text-sm text-stone-500">{{ 'The oldest known ancestor. They become Generation 1; descendants are numbered from them.' | t }}</p>
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" class="size-4 accent-brand-700" [checked]="withFounder()" (change)="withFounder.set(!withFounder())" />
            {{ 'Add now' | t }}
          </label>
        </div>
        @if (withFounder()) {
          <fh-member-fields [form]="founder" [compact]="true" [error]="error()" errorPrefix="founder." />
        } @else {
          <p class="rounded-xl bg-stone-50 p-4 text-sm text-stone-600 dark:bg-stone-800/60 dark:text-stone-300">
            {{ 'You can choose the founding ancestor later from the family settings.' | t }}
          </p>
        }
      </section>

      <div class="flex gap-3">
        <button type="submit" class="btn-primary" [disabled]="busy()">{{ busy() ? ('Registering…' | t) : ('Register family' | t) }}</button>
        <a routerLink="/dashboard" class="btn-secondary">{{ 'Cancel' | t }}</a>
      </div>
    </form>
  `,
})
export class CreateFamilyPage {
  private readonly familiesApi = inject(FamiliesApi);
  private readonly context = inject(FamilyContextStore);
  private readonly router = inject(Router);

  protected readonly family = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(FAMILY_NAME_MAX_LENGTH)]],
    description: [''],
    hometown: [''],
    region: [''],
    country: [''],
    history: [''],
    visibility: ['private' as FamilyVisibility],
  });
  protected readonly founder = memberForm();
  protected readonly withFounder = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly visibilities = [
    { value: 'private', label: mark('Private'), hint: mark('Only invited family members can see it.') },
    { value: 'unlisted', label: mark('Unlisted'), hint: mark('Anyone with the link can see deceased people you make public.') },
    { value: 'public', label: mark('Public'), hint: mark('Deceased people you make public can be found by anyone.') },
  ] as const;

  constructor() {
    this.founder.controls.vitalStatus.setValue('deceased');
  }

  protected async submit(): Promise<void> {
    const founderInvalid = this.withFounder() && this.founder.invalid;
    if (this.family.invalid || founderInvalid) {
      this.family.markAllAsTouched();
      this.founder.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const f = this.family.getRawValue();
    try {
      const created = await this.familiesApi.create({
        name: f.name.trim(),
        description: f.description.trim(),
        history: f.history.trim(),
        origin: { hometown: f.hometown.trim(), region: f.region.trim(), country: f.country.trim() },
        privacy: { visibility: f.visibility },
        ...(this.withFounder() ? { founder: memberInputFrom(this.founder) } : {}),
      });
      await this.context.load();
      await this.context.select(created.id);
      await this.router.navigateByUrl(created.foundingMemberId ? `/members/${created.foundingMemberId}` : '/family/settings');
    } catch (err) {
      this.error.set(ApiError.from(err));
    } finally {
      this.busy.set(false);
    }
  }
}
