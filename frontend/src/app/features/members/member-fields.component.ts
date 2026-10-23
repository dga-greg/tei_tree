import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LucidePlus, LucideX } from '@lucide/angular';
import { DEFAULT_LINEAGE_SETTINGS, GENDERS, MEMBER_PRIVACY_LABELS, MEMBER_PRIVACY_LEVELS } from '@fh/contracts';
import { FamilyContextStore } from '../../core/families/family-context.store';
import type { ApiError } from '../../core/api/api-error';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { FuzzyDateFieldComponent } from '../../shared/ui/fuzzy-date-field.component';
import type { MemberForm } from './member-fields';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** The person fields, shared by "add person", "edit person" and the founder step of family registration. */
@Component({
  selector: 'fh-member-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormFieldComponent, FuzzyDateFieldComponent, LucidePlus, LucideX, TranslatePipe],
  template: `
    <div [formGroup]="form()" class="space-y-8">
      <section aria-labelledby="names-h" class="space-y-4">
        <h3 id="names-h" class="font-sans text-sm font-semibold uppercase tracking-wide text-stone-500">{{ 'Names' | t }}</h3>
        <div class="grid gap-4 sm:grid-cols-[7rem_1fr_1fr]">
          <fh-form-field [label]="'Title' | t" [control]="form().controls.title" #ti>
            <input class="input" formControlName="title" [placeholder]="'Nana, Dr…' | t" [attr.id]="ti.controlId" />
          </fh-form-field>
          <fh-form-field [label]="'First name' | t" [control]="form().controls.firstName" [serverError]="err('firstName')" #fn>
            <input class="input" formControlName="firstName" [attr.id]="fn.controlId" [attr.aria-describedby]="fn.describedBy()" [attr.aria-invalid]="!!fn.error()" />
          </fh-form-field>
          <fh-form-field [label]="'Surname' | t" [control]="form().controls.surname" #sn>
            <input class="input" formControlName="surname" [attr.id]="sn.controlId" />
          </fh-form-field>
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <fh-form-field [label]="'Middle names' | t" [control]="form().controls.middleNames" #mn>
            <input class="input" formControlName="middleNames" [attr.id]="mn.controlId" />
          </fh-form-field>
          <fh-form-field [label]="'Preferred name' | t" [control]="form().controls.preferredName" [hint]="'What the family calls them' | t" #pn>
            <input class="input" formControlName="preferredName" [attr.id]="pn.controlId" [attr.aria-describedby]="pn.describedBy()" />
          </fh-form-field>
          <fh-form-field [label]="'Maiden name' | t" [control]="form().controls.maidenName" #mdn>
            <input class="input" formControlName="maidenName" [attr.id]="mdn.controlId" />
          </fh-form-field>
        </div>
        <fh-form-field [label]="'Other or previous names' | t" [control]="form().controls.previousNames" [hint]="'Separate with commas' | t" #on>
          <input class="input" formControlName="previousNames" [attr.id]="on.controlId" [attr.aria-describedby]="on.describedBy()" />
        </fh-form-field>
        <fh-form-field [label]="'Gender (optional)' | t" [control]="form().controls.gender" #g>
          <select class="input sm:!w-60" formControlName="gender" [attr.id]="g.controlId">
            <option value="">{{ 'Not recorded' | t }}</option>
            @for (x of genders; track x) {
              <option [value]="x">{{ genderLabel(x) }}</option>
            }
          </select>
        </fh-form-field>
      </section>

      <section aria-labelledby="life-h" class="space-y-4">
        <h3 id="life-h" class="font-sans text-sm font-semibold uppercase tracking-wide text-stone-500">{{ 'Life' | t }}</h3>
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
        <div class="grid gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <fh-fuzzy-date-field [label]="'Date of birth' | t" [form]="form().controls.birthDate" [error]="err('birthDate')" />
          <fh-form-field [label]="'Place of birth' | t" [control]="form().controls.birthPlace" #bp>
            <input class="input" formControlName="birthPlace" [attr.id]="bp.controlId" />
          </fh-form-field>
        </div>
        @if (form().controls.vitalStatus.value !== 'living') {
          <div class="grid gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <fh-fuzzy-date-field [label]="'Date of death' | t" [form]="form().controls.deathDate" [error]="err('deathDate')" />
            <fh-form-field [label]="'Place of death' | t" [control]="form().controls.deathPlace" #dp>
              <input class="input" formControlName="deathPlace" [attr.id]="dp.controlId" />
            </fh-form-field>
          </div>
        }
        <div class="grid gap-4 sm:grid-cols-2">
          <fh-form-field [label]="'Hometown' | t" [control]="form().controls.hometown" #ht>
            <input class="input" formControlName="hometown" [attr.id]="ht.controlId" />
          </fh-form-field>
          <fh-form-field [label]="'Nationality' | t" [control]="form().controls.nationality" #nat>
            <input class="input" formControlName="nationality" [attr.id]="nat.controlId" />
          </fh-form-field>
        </div>
        @if (lineage(); as l) {
          <div class="grid gap-4 sm:grid-cols-3">
            @if (l.maternal.enabled) {
              <fh-form-field [label]="'{line} (through the mother)' | t: { line: l.maternal.label }" [control]="form().controls.maternalLine" [hint]="motherHint" #ml>
                <input class="input" formControlName="maternalLine" [attr.id]="ml.controlId" [placeholder]="'e.g. Oyoko' | t" />
              </fh-form-field>
            }
            @if (l.paternal.enabled) {
              <fh-form-field [label]="'{line} (through the father)' | t: { line: l.paternal.label }" [control]="form().controls.paternalLine" [hint]="fatherHint" #pl>
                <input class="input" formControlName="paternalLine" [attr.id]="pl.controlId" [placeholder]="'e.g. Bosompra' | t" />
              </fh-form-field>
            }
            <fh-form-field [label]="'Totem' | t" [control]="form().controls.totem" [hint]="l.totemFollows === 'maternal' ? motherHint : fatherHint" #tt>
              <input class="input" formControlName="totem" [attr.id]="tt.controlId" [placeholder]="'e.g. Parrot' | t" />
            </fh-form-field>
          </div>
        }
      </section>

      @if (!compact()) {
        <section aria-labelledby="story-h" class="space-y-4">
          <h3 id="story-h" class="font-sans text-sm font-semibold uppercase tracking-wide text-stone-500">{{ 'Story' | t }}</h3>
          <fh-form-field [label]="'Biography' | t" [control]="form().controls.biography" #bio>
            <textarea class="input min-h-32" formControlName="biography" [attr.id]="bio.controlId"></textarea>
          </fh-form-field>
          @for (list of lists; track list.key) {
            <fieldset>
              <legend class="label">{{ list.label }}</legend>
              <div class="space-y-2">
                @for (c of form().controls[list.key].controls; track $index) {
                  <div class="flex gap-2">
                    <label class="sr-only" [for]="list.key + $index">{{ list.label }} {{ $index + 1 }}</label>
                    <input class="input" [id]="list.key + $index" [formControl]="asControl(c)" [placeholder]="list.placeholder" />
                    <button type="button" class="btn-ghost !px-2" (click)="form().controls[list.key].removeAt($index)" [attr.aria-label]="'Remove {label} {number}' | t: { label: list.label, number: $index + 1 }">
                      <svg lucideX class="size-4"></svg>
                    </button>
                  </div>
                }
              </div>
              <button type="button" class="btn-ghost mt-2 !px-2 !py-1 text-sm" (click)="add(list.key)">
                <svg lucidePlus class="size-4"></svg> {{ list.add }}
              </button>
            </fieldset>
          }
          <fh-form-field [label]="'Achievements' | t" [control]="form().controls.achievements" [hint]="'One per line' | t" #ach>
            <textarea class="input min-h-20" formControlName="achievements" [attr.id]="ach.controlId" [attr.aria-describedby]="ach.describedBy()"></textarea>
          </fh-form-field>
        </section>

        <section aria-labelledby="privacy-h" class="space-y-4">
          <h3 id="privacy-h" class="font-sans text-sm font-semibold uppercase tracking-wide text-stone-500">{{ 'Privacy & contact' | t }}</h3>
          <fh-form-field [label]="'Who can see this profile' | t" [control]="form().controls.privacyLevel" [serverError]="err('privacy.level')" #pl>
            <select class="input sm:!w-80" formControlName="privacyLevel" [attr.id]="pl.controlId" [attr.aria-describedby]="pl.describedBy()">
              @for (l of privacyLevels; track l) {
                <option [value]="l" [disabled]="l === 'public' && form().controls.vitalStatus.value !== 'deceased'">{{ privacyLabels[l] | t }}</option>
              }
            </select>
          </fh-form-field>
          <label class="flex items-start gap-3 text-sm">
            <input type="checkbox" class="mt-0.5 size-4 accent-brand-700" formControlName="hideDates" />
            <span>{{ 'Show only the year of birth to other family members' | t }}</span>
          </label>
          <p class="text-xs text-stone-500">{{ 'Contact details are visible only to administrators and to the person themselves.' | t }}</p>
          <div class="grid gap-4 sm:grid-cols-2">
            <fh-form-field [label]="'E-mail' | t" [control]="form().controls.email" [serverError]="err('contact.email')" #em>
              <input class="input" type="email" formControlName="email" [attr.id]="em.controlId" [attr.aria-describedby]="em.describedBy()" />
            </fh-form-field>
            <fh-form-field [label]="'Phone' | t" [control]="form().controls.phone" #ph>
              <input class="input" type="tel" formControlName="phone" [attr.id]="ph.controlId" />
            </fh-form-field>
          </div>
          <fh-form-field [label]="'Address' | t" [control]="form().controls.address" #ad>
            <textarea class="input" formControlName="address" [attr.id]="ad.controlId"></textarea>
          </fh-form-field>
        </section>
      }
    </div>
  `,
})
export class MemberFieldsComponent {
  readonly form = input.required<MemberForm>();
  readonly error = input<ApiError | null>(null);
  /** Hides story and privacy sections (used for the founder step of registration). */
  readonly compact = input(false);
  /** Prefix of server error paths, e.g. `person.` for the create endpoint. */
  readonly errorPrefix = input('');

  private readonly context = inject(FamilyContextStore);
  /** The family's lines and their names (e.g. abusua and ntoro); defaults until the family's settings load. */
  protected readonly lineage = computed(() => this.context.details()?.lineage ?? DEFAULT_LINEAGE_SETTINGS);
  protected readonly genders = GENDERS;
  protected readonly privacyLevels = MEMBER_PRIVACY_LEVELS;
  protected readonly privacyLabels = MEMBER_PRIVACY_LABELS;
  protected readonly statuses = [
    { value: 'living', label: mark('Living') },
    { value: 'deceased', label: mark('Deceased') },
    { value: 'unknown', label: mark('Unknown') },
  ] as const;
  protected readonly motherHint = t("Leave empty to take the mother's.");
  protected readonly fatherHint = t("Leave empty to take the father's.");
  protected readonly lists = [
    { key: 'occupations', label: t('Occupations'), add: t('Add occupation'), placeholder: t('e.g. Cocoa farmer') },
    { key: 'education', label: t('Education'), add: t('Add school'), placeholder: t('e.g. Achimota School') },
  ] as const;

  protected err(path: string): string | undefined {
    const e = this.error();
    if (!e) return undefined;
    const full = this.errorPrefix() + path;
    return e.details.find((d) => d.path === full || d.path.startsWith(full + '.'))?.message;
  }

  protected genderLabel(g: string): string {
    const labels: Record<string, string> = {
      female: t('Female'),
      male: t('Male'),
      non_binary: t('Non-binary'),
      other: t('Other'),
      undisclosed: t('Prefer not to say'),
    };
    return labels[g] ?? g[0]!.toUpperCase() + g.slice(1);
  }

  protected add(key: 'occupations' | 'education'): void {
    this.form().controls[key].push(new FormControl('', { nonNullable: true }));
  }

  protected asControl(c: unknown): FormControl<string> {
    return c as FormControl<string>;
  }
}
