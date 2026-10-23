import { type FuzzyDate } from '@fh/contracts';
import { mark, t } from '../core/i18n/i18n';
import { formatFuzzyDate } from './format';

/** Names of record fields (marked; shown through `fieldLabel`, which translates them). */
export const FIELD_LABELS: Record<string, string> = {
  firstName: mark('First name'),
  middleNames: mark('Middle names'),
  surname: mark('Surname'),
  maidenName: mark('Maiden name'),
  previousNames: mark('Other names'),
  preferredName: mark('Preferred name'),
  title: mark('Title'),
  gender: mark('Gender'),
  vitalStatus: mark('Living or deceased'),
  birthDate: mark('Date of birth'),
  birthPlace: mark('Place of birth'),
  deathDate: mark('Date of death'),
  deathPlace: mark('Place of death'),
  nationality: mark('Nationality'),
  hometown: mark('Hometown'),
  biography: mark('Biography'),
  education: mark('Education'),
  occupations: mark('Occupations'),
  achievements: mark('Achievements'),
  sources: mark('Sources'),
  privacy: mark('Privacy'),
  contact: mark('Contact details'),
  subtype: mark('Type'),
  status: mark('Status'),
  startDate: mark('Start'),
  endDate: mark('End'),
  verification: mark('Certainty'),
  notes: mark('Notes'),
};

const isDate = (v: unknown): v is FuzzyDate => !!v && typeof v === 'object' && 'qualifier' in (v as object);

/** Readable text for any stored or proposed value (dates, lists, nested objects). */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (isDate(value)) return formatFuzzyDate(value) || '—';
  if (Array.isArray(value)) {
    if (!value.length) return '—';
    return value.map((v) => (v && typeof v === 'object' && 'title' in v ? String((v as { title: string }).title) : formatValue(v))).join(', ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([k, v]) => k !== '_id' && v !== undefined && v !== null && v !== '');
    return entries.length ? entries.map(([k, v]) => `${fieldLabel(k)}: ${formatValue(v)}`).join('; ') : '—';
  }
  if (typeof value === 'boolean') return value ? t('Yes') : t('No');
  return String(value).replace(/_/g, ' ');
}

export function fieldLabel(field: string): string {
  const label = FIELD_LABELS[field];
  return label ? t(label) : field;
}
