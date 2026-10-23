import { registerLocaleData } from '@angular/common';
import { DEFAULT_LANGUAGE, languageOf, LANGUAGES, type Language } from './languages';

/**
 * Runtime translations. Texts are written in English in templates (`{{ 'Save' | t }}`) and code (`t('Save')`);
 * the English text is the key into the active language's catalog. The language is chosen once, before the app
 * starts, so lookups are plain function calls; changing language reloads the page.
 *
 * Parameters: `t('Hello {name}', { name })`. Plurals (ICU): `t('{count, plural, one {# person} other {# people}}', { count })`.
 */
type Params = Record<string, unknown>;

const STORAGE_KEY = 'fh-language';
let catalog: Record<string, string> = {};
let current: Language = languageOf(DEFAULT_LANGUAGE)!;

export function currentLanguage(): Language {
  return current;
}

/** The text in the active language (the English text when there is no translation yet). */
export function t(key: string, params?: Params): string {
  const text = catalog[key] || key;
  return params || text.includes('{') ? format(text, params ?? {}) : text;
}

/**
 * Marks a text for translation without translating it yet: for constants defined when the code loads (menus,
 * option lists), which is before the language is known. Show them with `| t` or `t(...)`.
 */
export function mark<T extends string>(key: T): T {
  return key;
}

/**
 * A message from the server in the active language when the catalog knows it exactly, else as sent. No parameter
 * formatting: server messages can contain names and other text typed by people.
 */
export function translateMessage(message: string): string {
  return catalog[message] || message;
}

// ------------------------------------------------------------------ formatting (a small ICU subset)

function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function plural(body: string, value: number, params: Params): string {
  const options = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open < 0) break;
    const selector = body.slice(i, open).trim();
    const end = closing(body, open);
    if (end < 0) break;
    options.set(selector, body.slice(open + 1, end));
    i = end + 1;
  }
  const rule = new Intl.PluralRules(current.formats).select(value);
  const chosen = options.get(`=${value}`) ?? options.get(rule) ?? options.get('other') ?? '';
  return format(chosen.replace(/#/g, new Intl.NumberFormat(current.formats).format(value)), params);
}

export function format(text: string, params: Params): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) return out + text.slice(i);
    out += text.slice(i, open);
    const end = closing(text, open);
    if (end < 0) return out + text.slice(open);
    const inner = text.slice(open + 1, end);
    const comma = inner.indexOf(',');
    if (comma < 0) {
      const v = params[inner.trim()];
      out += v === undefined || v === null ? '' : String(v);
    } else {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1);
      const second = rest.indexOf(',');
      const type = rest.slice(0, second).trim();
      const body = rest.slice(second + 1);
      out += type === 'plural' ? plural(body, Number(params[name] ?? 0), params) : inner;
    }
    i = end + 1;
  }
  return out;
}

// ------------------------------------------------------------------ choosing and loading the language

const LOCALE_DATA: Record<string, () => Promise<{ default: unknown[] }>> = {};

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The language to start in: the one chosen on this device, else the browser's, else English. */
export function preferredLanguage(): string {
  const chosen = languageOf(stored());
  if (chosen) return chosen.code;
  for (const tag of typeof navigator !== 'undefined' ? navigator.languages ?? [] : []) {
    const base = tag.toLowerCase().split('-')[0];
    const match = LANGUAGES.find((l) => l.code === base);
    if (match) return match.code;
  }
  return DEFAULT_LANGUAGE;
}

/** Loads the catalog and date/number formats. Called before the app starts; never fails (English then). */
export async function loadLanguage(code = preferredLanguage()): Promise<void> {
  const lang = languageOf(code) ?? languageOf(DEFAULT_LANGUAGE)!;
  try {
    if (lang.code !== DEFAULT_LANGUAGE) {
      const res = await fetch(`/i18n/${lang.code}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      catalog = (await res.json()) as Record<string, string>;
    }
    const data = LOCALE_DATA[lang.formats];
    if (data) registerLocaleData((await data()).default, lang.formats);
    current = lang;
  } catch (err) {
    console.warn(`Could not load the ${lang.name} translation; using English.`, err);
    catalog = {};
    current = languageOf(DEFAULT_LANGUAGE)!;
  }
  if (typeof document !== 'undefined') document.documentElement.lang = current.code;
}

/** Remembers the language on this device and restarts the app in it. */
export function switchLanguage(code: string, reload = true): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* private mode: the choice lasts this visit only */
  }
  if (reload && code !== current.code) location.reload();
}

/** For tests: use a catalog directly. */
export function useCatalog(code: string, entries: Record<string, string>): void {
  current = languageOf(code) ?? current;
  catalog = entries;
}
