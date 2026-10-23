import type { FuzzyDate, GenerationInfo, PersonCard } from '@fh/contracts';
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

/** Short label for a generation, never relying on colour alone. */
export function generationLabel(g: GenerationInfo): string {
  switch (g.status) {
    case 'founder':
      return t('G1 · Founder');
    case 'computed':
      return `G${g.number}`;
    case 'conflict':
      return `G${g.candidates.join('/')}?`;
    case 'married_in':
      return t('Married in');
    case 'unconnected':
      return t('Not connected');
    case 'unverified_path':
      return t('Unverified');
    case 'pending':
      return g.number ? `G${g.number}` : t('Gen. pending');
  }
}

/** Tailwind classes for the generation accent scale (repeats after G8). */
export function generationTone(g: GenerationInfo): string {
  if (!g.number) return 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300';
  const n = ((g.number - 1) % 8) + 1;
  return `bg-gen-${n}-tint text-gen-${n}-ink`;
}

export function dateToInput(d: FuzzyDate | null | undefined): FuzzyDate | null {
  return d ?? null;
}
