import type { FuzzyDate, PersonCard } from '@fh/contracts';
import { t } from '../core/i18n/i18n';
import { formatFuzzyDate } from './format';

/** "1890 – 1962", "b. 1985", "about 1890 – ?" — only what the viewer is allowed to see. */
export function lifespan(p: Pick<PersonCard, 'birthDate' | 'deathDate' | 'vitalStatus'>): string {
  const born = formatFuzzyDate(p.birthDate);
  const died = formatFuzzyDate(p.deathDate);
  if (died) return `${born || '?'} – ${died}`;
  if (p.vitalStatus === 'deceased') return born ? `${born} – ?` : t('Deceased');
  return born ? t('b. {date}', { date: born }) : '';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function dateToInput(d: FuzzyDate | null | undefined): FuzzyDate | null {
  return d ?? null;
}
