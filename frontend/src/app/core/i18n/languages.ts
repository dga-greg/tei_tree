/**
 * Languages of the interface. English is the source: every text in the app is written in English and looked up
 * in the active language's catalog (public/i18n/<code>.json); anything missing falls back to the English.
 * This build is English only; a language is added by listing it here with its catalog.
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
];

export const DEFAULT_LANGUAGE = 'en';

export function languageOf(code: string | null | undefined): Language | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
