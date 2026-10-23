import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DATE_QUALIFIERS, type DateQualifier, type FuzzyDate } from '@fh/contracts';
import { mark } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export type FuzzyDateForm = FormGroup<{
  qualifier: FormControl<DateQualifier>;
  year: FormControl<number | null>;
  month: FormControl<number | null>;
  day: FormControl<number | null>;
  endYear: FormControl<number | null>;
  text: FormControl<string>;
}>;

export function fuzzyDateForm(value?: FuzzyDate | null): FuzzyDateForm {
  return new FormGroup({
    qualifier: new FormControl<DateQualifier>(value?.qualifier ?? 'exact', { nonNullable: true }),
    year: new FormControl<number | null>(value?.year ?? null),
    month: new FormControl<number | null>(value?.month ?? null),
    day: new FormControl<number | null>(value?.day ?? null),
    endYear: new FormControl<number | null>(value?.endYear ?? null),
    text: new FormControl<string>(value?.text ?? '', { nonNullable: true }),
  });
}

/** Converts the form back to the API shape; an empty date becomes null. */
export function fuzzyDateValue(form: FuzzyDateForm): FuzzyDate | null {
  const v = form.getRawValue();
  const num = (x: number | null) => (x === null || (x as unknown) === '' || Number.isNaN(Number(x)) ? undefined : Number(x));
  const year = num(v.year);
  const text = v.text.trim() || undefined;
  if (year === undefined && !text) return null;
  const out: FuzzyDate = { qualifier: v.qualifier };
  if (year !== undefined) out.year = year;
  const month = num(v.month);
  if (month !== undefined) out.month = month;
  const day = num(v.day);
  if (day !== undefined) out.day = day;
  if (v.qualifier === 'between') {
    const end = num(v.endYear);
    if (end !== undefined) out.endYear = end;
  }
  if (text) out.text = text;
  return out;
}

const QUALIFIER_LABELS: Record<DateQualifier, string> = {
  exact: mark('Exactly'),
  about: mark('About'),
  estimated: mark('Estimated'),
  before: mark('Before'),
  after: mark('After'),
  between: mark('Between'),
};

const MONTHS = [
  mark('January'),
  mark('February'),
  mark('March'),
  mark('April'),
  mark('May'),
  mark('June'),
  mark('July'),
  mark('August'),
  mark('September'),
  mark('October'),
  mark('November'),
  mark('December'),
];

let nextId = 0;

/**
 * Entry for partial or approximate dates: qualifier + year (+ optional month/day), an end year for
 * ranges, and free text for dates only known by description.
 */
@Component({
  selector: 'fh-fuzzy-date-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <fieldset [formGroup]="form()" class="min-w-0" [attr.aria-describedby]="error() ? errorId : null">
      <legend class="label">{{ label() }}</legend>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,8.5rem)_minmax(0,6rem)_minmax(0,9rem)_minmax(0,5rem)]">
        <label class="sr-only" [for]="id + '-q'">{{ '{label}: precision' | t: { label: label() } }}</label>
        <select class="input" [id]="id + '-q'" formControlName="qualifier">
          @for (q of qualifiers; track q) {
            <option [value]="q">{{ qualifierLabels[q] | t }}</option>
          }
        </select>
        <label class="sr-only" [for]="id + '-y'">{{ '{label}: year' | t: { label: label() } }}</label>
        <input class="input" [id]="id + '-y'" type="number" inputmode="numeric" [placeholder]="'Year' | t" formControlName="year" min="1" />
        <label class="sr-only" [for]="id + '-m'">{{ '{label}: month' | t: { label: label() } }}</label>
        <select class="input" [id]="id + '-m'" formControlName="month">
          <option [ngValue]="null">{{ 'Month' | t }}</option>
          @for (m of months; track $index) {
            <option [ngValue]="$index + 1">{{ m | t }}</option>
          }
        </select>
        <label class="sr-only" [for]="id + '-d'">{{ '{label}: day' | t: { label: label() } }}</label>
        <input class="input" [id]="id + '-d'" type="number" inputmode="numeric" [placeholder]="'Day' | t" formControlName="day" min="1" max="31" />
      </div>
      @if (form().controls.qualifier.value === 'between') {
        <div class="mt-2 flex items-center gap-2">
          <label class="text-sm text-stone-600 dark:text-stone-400" [for]="id + '-e'">{{ 'and' | t }}</label>
          <input class="input !w-28" [id]="id + '-e'" type="number" inputmode="numeric" [placeholder]="'End year' | t" formControlName="endYear" />
        </div>
      }
      <label class="sr-only" [for]="id + '-t'">{{ '{label}: description' | t: { label: label() } }}</label>
      <input class="input mt-2" [id]="id + '-t'" formControlName="text" [placeholder]="'Or describe it, e.g. “the year of the great harvest”' | t" />
      @if (error()) {
        <p class="mt-1.5 text-sm text-red-700 dark:text-red-400" [id]="errorId">{{ error() }}</p>
      }
    </fieldset>
  `,
})
export class FuzzyDateFieldComponent {
  readonly form = input.required<FuzzyDateForm>();
  readonly label = input.required<string>();
  readonly error = input<string | undefined>();

  protected readonly id = `fh-date-${nextId++}`;
  protected readonly errorId = `${this.id}-error`;
  protected readonly qualifiers = DATE_QUALIFIERS;
  protected readonly qualifierLabels = QUALIFIER_LABELS;
  protected readonly months = MONTHS;
}
