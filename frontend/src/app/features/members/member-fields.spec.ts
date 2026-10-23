import { fuzzyDateForm, fuzzyDateValue } from '../../shared/ui/fuzzy-date-field.component';
import { generationLabel, lifespan } from '../../shared/people';
import { changedFields, memberForm, memberInputFrom } from './member-fields';

describe('fuzzy date form', () => {
  it('round-trips partial and approximate dates', () => {
    expect(fuzzyDateValue(fuzzyDateForm({ year: 1890, qualifier: 'about' }))).toEqual({ year: 1890, qualifier: 'about' });
    expect(fuzzyDateValue(fuzzyDateForm({ year: 1954, month: 3, day: 12, qualifier: 'exact' }))).toEqual({ year: 1954, month: 3, day: 12, qualifier: 'exact' });
    expect(fuzzyDateValue(fuzzyDateForm({ qualifier: 'estimated', text: 'the year of the flood' }))).toEqual({ qualifier: 'estimated', text: 'the year of the flood' });
  });

  it('treats an empty date as no date and drops the end year unless it is a range', () => {
    expect(fuzzyDateValue(fuzzyDateForm())).toBeNull();
    const f = fuzzyDateForm({ year: 1900, endYear: 1910, qualifier: 'between' });
    expect(fuzzyDateValue(f)).toEqual({ year: 1900, endYear: 1910, qualifier: 'between' });
    f.controls.qualifier.setValue('about');
    expect(fuzzyDateValue(f)).toEqual({ year: 1900, qualifier: 'about' });
  });
});

describe('member form', () => {
  it('builds the API payload, clearing death details for living people', () => {
    const form = memberForm();
    form.patchValue({ firstName: ' Kwame ', surname: 'Mensah', previousNames: 'Kwame Asante, Quame', vitalStatus: 'living', deathPlace: 'Accra', achievements: 'First graduate\n\nChief' });
    form.controls.deathDate.patchValue({ year: 2001 });
    const input = memberInputFrom(form);
    expect(input).toMatchObject({
      firstName: 'Kwame',
      previousNames: ['Kwame Asante', 'Quame'],
      vitalStatus: 'living',
      deathDate: null,
      deathPlace: '',
      achievements: ['First graduate', 'Chief'],
      contact: null,
      gender: null,
    });
  });
});

describe('people helpers', () => {
  it('formats lifespans from whatever is known', () => {
    expect(lifespan({ birthDate: { year: 1890, qualifier: 'about' }, deathDate: { year: 1962, qualifier: 'exact' }, vitalStatus: 'deceased' })).toBe('about 1890 – 1962');
    expect(lifespan({ birthDate: { year: 1985, qualifier: 'exact' }, deathDate: null, vitalStatus: 'living' })).toBe('b. 1985');
    expect(lifespan({ birthDate: null, deathDate: null, vitalStatus: 'deceased' })).toBe('Deceased');
    expect(lifespan({ birthDate: null, deathDate: null, vitalStatus: null })).toBe('');
  });

  it('labels generations without relying on colour', () => {
    expect(generationLabel({ number: 1, status: 'founder', candidates: [], overridden: false })).toBe('G1 · Founder');
    expect(generationLabel({ number: null, status: 'conflict', candidates: [4, 5], overridden: false })).toBe('G4/5?');
    expect(generationLabel({ number: null, status: 'pending', candidates: [], overridden: false })).toBe('Gen. pending');
  });
});

describe('changed fields', () => {
  it('returns only what the form changed, so suggestions stay small', () => {
    const form = memberForm();
    form.patchValue({ firstName: 'Ama', surname: 'Owusu', vitalStatus: 'living', hometown: 'Kumasi' });
    const existing = { ...memberInputFrom(form), id: 'x', occupations: [], education: [] } as never;
    const edit = memberForm(existing);
    expect(changedFields(edit, existing)).toEqual({});
    edit.patchValue({ hometown: 'Accra', surname: 'Owusu-Ansah' });
    expect(changedFields(edit, existing)).toEqual({ hometown: 'Accra', surname: 'Owusu-Ansah' });
  });
});
