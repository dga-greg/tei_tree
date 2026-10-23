import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { ATTRIBUTE_NAME_MAX_LENGTH, ATTRIBUTE_VALUE_MAX_LENGTH, type Gender, type MemberAttribute, type MemberInput, type MemberView, type VitalStatus } from '@fh/contracts';
import { fuzzyDateForm, fuzzyDateValue, type FuzzyDateForm } from '../../shared/ui/fuzzy-date-field.component';

export type AttributeForm = FormGroup<{ name: FormControl<string>; value: FormControl<string> }>;

export type MemberForm = FormGroup<{
  firstName: FormControl<string>;
  surname: FormControl<string>;
  preferredName: FormControl<string>;
  gender: FormControl<Gender | ''>;
  residence: FormControl<string>;
  vitalStatus: FormControl<VitalStatus>;
  birthDate: FuzzyDateForm;
  deathDate: FuzzyDateForm;
  attributes: FormArray<AttributeForm>;
}>;

const text = (v = '', max = 200) => new FormControl(v, { nonNullable: true, validators: [Validators.maxLength(max)] });

export function attributeForm(a?: MemberAttribute): AttributeForm {
  return new FormGroup({
    name: new FormControl(a?.name ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(ATTRIBUTE_NAME_MAX_LENGTH)] }),
    value: text(a?.value ?? '', ATTRIBUTE_VALUE_MAX_LENGTH),
  });
}

export function memberForm(m?: MemberView | null): MemberForm {
  return new FormGroup({
    firstName: new FormControl(m?.firstName ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    surname: text(m?.surname, 100),
    preferredName: text(m?.preferredName, 100),
    gender: new FormControl<Gender | ''>(m?.gender ?? '', { nonNullable: true }),
    residence: text(m?.residence ?? ''),
    vitalStatus: new FormControl<VitalStatus>(m?.vitalStatus ?? 'living', { nonNullable: true }),
    birthDate: fuzzyDateForm(m?.birthDate),
    deathDate: fuzzyDateForm(m?.deathDate),
    attributes: new FormArray((m?.attributes ?? []).map(attributeForm)),
  });
}

/** The form in the API's shape. A date of death is kept only for people recorded as deceased. */
export function memberInputFrom(form: MemberForm): MemberInput {
  const v = form.getRawValue();
  return {
    firstName: v.firstName.trim(),
    surname: v.surname.trim(),
    preferredName: v.preferredName.trim(),
    gender: v.gender || null,
    residence: v.residence.trim(),
    vitalStatus: v.vitalStatus,
    birthDate: fuzzyDateValue(form.controls.birthDate),
    deathDate: v.vitalStatus === 'deceased' ? fuzzyDateValue(form.controls.deathDate) : null,
    attributes: v.attributes.map((a) => ({ name: a.name.trim(), value: a.value.trim() })).filter((a) => a.name),
  };
}
