import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import type { Gender, MemberInput, MemberPrivacyLevel, MemberView, VitalStatus } from '@fh/contracts';
import { fuzzyDateForm, fuzzyDateValue, type FuzzyDateForm } from '../../shared/ui/fuzzy-date-field.component';

export type MemberForm = FormGroup<{
  title: FormControl<string>;
  firstName: FormControl<string>;
  middleNames: FormControl<string>;
  surname: FormControl<string>;
  maidenName: FormControl<string>;
  preferredName: FormControl<string>;
  previousNames: FormControl<string>;
  gender: FormControl<Gender | ''>;
  vitalStatus: FormControl<VitalStatus>;
  birthDate: FuzzyDateForm;
  birthPlace: FormControl<string>;
  deathDate: FuzzyDateForm;
  deathPlace: FormControl<string>;
  nationality: FormControl<string>;
  hometown: FormControl<string>;
  maternalLine: FormControl<string>;
  paternalLine: FormControl<string>;
  totem: FormControl<string>;
  biography: FormControl<string>;
  occupations: FormArray<FormControl<string>>;
  education: FormArray<FormControl<string>>;
  achievements: FormControl<string>;
  privacyLevel: FormControl<MemberPrivacyLevel>;
  hideDates: FormControl<boolean>;
  email: FormControl<string>;
  phone: FormControl<string>;
  address: FormControl<string>;
}>;

const text = (v = '', ...validators: ReturnType<typeof Validators.maxLength>[]) => new FormControl(v, { nonNullable: true, validators });

export function memberForm(m?: MemberView | null): MemberForm {
  return new FormGroup({
    title: text(m?.title),
    firstName: new FormControl(m?.firstName ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    middleNames: text(m?.middleNames),
    surname: text(m?.surname),
    maidenName: text(m?.maidenName),
    preferredName: text(m?.preferredName),
    previousNames: text(m?.previousNames.join(', ')),
    gender: new FormControl<Gender | ''>(m?.gender ?? '', { nonNullable: true }),
    vitalStatus: new FormControl<VitalStatus>(m?.vitalStatus ?? 'unknown', { nonNullable: true }),
    birthDate: fuzzyDateForm(m?.birthDate),
    birthPlace: text(m?.birthPlace ?? ''),
    deathDate: fuzzyDateForm(m?.deathDate),
    deathPlace: text(m?.deathPlace ?? ''),
    nationality: text(m?.nationality ?? ''),
    hometown: text(m?.hometown ?? ''),
    maternalLine: text(m?.maternalLine ?? ''),
    paternalLine: text(m?.paternalLine ?? ''),
    totem: text(m?.totem ?? ''),
    biography: text(m?.biography ?? ''),
    occupations: new FormArray((m?.occupations ?? []).map((o) => text(o.title))),
    education: new FormArray((m?.education ?? []).map((e) => text(e.title))),
    achievements: text(m?.achievements.join('\n')),
    privacyLevel: new FormControl<MemberPrivacyLevel>(m?.privacy?.level ?? 'family', { nonNullable: true }),
    hideDates: new FormControl(m?.privacy?.hideDates ?? false, { nonNullable: true }),
    email: text(m?.contact?.email ?? ''),
    phone: text(m?.contact?.phone ?? ''),
    address: text(m?.contact?.address ?? ''),
  });
}

/**
 * Converts the form to the API shape. Timeline entries keep their existing details (dates,
 * organisation) when only the title list is edited here.
 */
export function memberInputFrom(form: MemberForm, existing?: MemberView | null): MemberInput {
  const v = form.getRawValue();
  const living = v.vitalStatus === 'living';
  const list = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);
  const timeline = (titles: string[], prior: MemberView['occupations'] = []) =>
    titles.map((t) => t.trim()).filter(Boolean).map((title) => prior.find((p) => p.title === title) ?? { title });
  const contact = { email: v.email.trim(), phone: v.phone.trim(), address: v.address.trim() };
  return {
    title: v.title.trim(),
    firstName: v.firstName.trim(),
    middleNames: v.middleNames.trim(),
    surname: v.surname.trim(),
    maidenName: v.maidenName.trim(),
    preferredName: v.preferredName.trim(),
    previousNames: list(v.previousNames, /,/),
    gender: v.gender || null,
    vitalStatus: v.vitalStatus,
    birthDate: fuzzyDateValue(form.controls.birthDate),
    birthPlace: v.birthPlace.trim(),
    deathDate: living ? null : fuzzyDateValue(form.controls.deathDate),
    deathPlace: living ? '' : v.deathPlace.trim(),
    nationality: v.nationality.trim(),
    hometown: v.hometown.trim(),
    maternalLine: v.maternalLine.trim(),
    paternalLine: v.paternalLine.trim(),
    totem: v.totem.trim(),
    biography: v.biography.trim(),
    occupations: timeline(v.occupations, existing?.occupations),
    education: timeline(v.education, existing?.education),
    achievements: list(v.achievements, /\n/),
    privacy: { level: v.privacyLevel, hideDates: v.hideDates },
    contact: contact.email || contact.phone || contact.address ? contact : null,
  };
}

/** Only the fields the form changed, compared like for like. */
export function changedFields(form: MemberForm, existing: MemberView): Partial<MemberInput> {
  const now = memberInputFrom(form, existing) as unknown as Record<string, unknown>;
  const before = memberInputFrom(memberForm(existing), existing) as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k]))) as Partial<MemberInput>;
}
