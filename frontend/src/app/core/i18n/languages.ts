/**
 * Languages of the interface. English is the source: every text in the app is written in English and looked up
 * in the active language's catalog (public/i18n/<code>.json); anything missing falls back to the English.
 * Draft translations were made without native speakers and wait for their review.
 */
export interface Language {
  code: string;
  /** In English. */
  name: string;
  /** In the language itself. */
  native: string;
  status: 'source' | 'complete' | 'draft';
  /** Angular (CLDR) locale for dates and numbers. */
  formats: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English', native: 'English', status: 'source', formats: 'en' },
  { code: 'fr', name: 'French', native: 'Français', status: 'complete', formats: 'fr' },
  { code: 'tw', name: 'Twi', native: 'Twi', status: 'draft', formats: 'ak' },
  { code: 'gaa', name: 'Ga', native: 'Gã', status: 'draft', formats: 'gaa' },
  { code: 'ee', name: 'Ewe', native: 'Eʋegbe', status: 'draft', formats: 'ee' },
  { code: 'ha', name: 'Hausa', native: 'Hausa', status: 'draft', formats: 'ha' },
];

export const DEFAULT_LANGUAGE = 'en';

export function languageOf(code: string | null | undefined): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
