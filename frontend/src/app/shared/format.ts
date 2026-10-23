import type { FuzzyDate } from '@fh/contracts';
import { currentLanguage, t } from '../core/i18n/i18n';

/**
 * Dates as genealogists record them, in the chosen language: "12 March 1950", "about 1885", "between 1900 and 1910".
 * Use this rather than `formatFuzzyDate` from @fh/contracts, which is English only (for the API and exports).
 */
export function formatFuzzyDate(date: FuzzyDate | null | undefined): string {
  if (!date) return '';
  if (!date.year) return date.text ?? '';
  const locale = currentLanguage().formats;
  let core: string;
  if (date.month && date.day) core = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(date.year, date.month - 1, date.day));
  else if (date.month) core = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(date.year, date.month - 1, 1));
  else core = String(date.year);
  switch (date.qualifier) {
    case 'about':
      return t('about {date}', { date: core });
    case 'estimated':
      return t('est. {date}', { date: core });
    case 'before':
      return t('before {date}', { date: core });
    case 'after':
      return t('after {date}', { date: core });
    case 'between':
      return date.endYear ? t('between {date} and {end}', { date: core, end: date.endYear }) : t('from {date}', { date: core });
    default:
      return core;
  }
}
