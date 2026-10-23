#!/usr/bin/env node
/**
 * Translation tooling. English texts are the keys (see src/app/core/i18n/i18n.ts).
 *
 *   node scripts/i18n.mjs extract   → src/i18n/keys.json: every text the app can show
 *   node scripts/i18n.mjs check     → every catalog in public/i18n has every key, with the same {placeholders}
 *   node scripts/i18n.mjs lint      → English left in templates that is not marked for translation
 *
 * Texts are found where they are marked: `'Text' | t` in templates, `t('Text')` and `mark('Text')` in code, the
 * `*_LABELS` maps of @fh/contracts, and the fixed messages the API sends (AppError and validation messages).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const appDir = join(root, 'src', 'app');
const keysFile = join(root, 'src', 'i18n', 'keys.json');
const catalogsDir = join(root, 'public', 'i18n');

function files(dir, test) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, test));
    else if (test(p)) out.push(p);
  }
  return out;
}

const unescape = (s, quote) => s.replace(new RegExp(`\\\\${quote}`, 'g'), quote).replace(/\\\\/g, '\\');
const STRING = (q) => `${q}((?:\\\\.|(?!${q})[^\\\\])*)${q}`;

/** Marked texts in one source file. */
export function marked(source) {
  const keys = new Set();
  for (const q of ["'", '"']) {
    // In templates: 'Text' | t   (also inside bindings)
    for (const m of source.matchAll(new RegExp(`${STRING(q)}\\s*\\|\\s*t\\b`, 'g'))) keys.add(unescape(m[1], q));
    // In code: t('Text'), mark('Text')
    for (const m of source.matchAll(new RegExp(`\\b(?:t|mark)\\(\\s*${STRING(q)}`, 'g'))) keys.add(unescape(m[1], q));
  }
  for (const m of source.matchAll(/\b(?:t|mark)\(\s*`((?:\\.|[^`\\])*)`/g)) if (!m[1].includes('${')) keys.add(m[1].replace(/\\`/g, '`'));
  return keys;
}

/** Fixed messages the API can send, which the app shows as they come (translated when the catalog knows them). */
function apiMessages() {
  const keys = new Set();
  for (const f of files(join(repo, 'backend', 'src'), (p) => p.endsWith('.ts'))) {
    const s = readFileSync(f, 'utf8');
    for (const q of ["'", '"']) {
      const str = STRING(q);
      for (const m of s.matchAll(new RegExp(`new AppError\\(\\s*'\\w+',\\s*${str}`, 'g'))) keys.add(unescape(m[1], q));
      for (const m of s.matchAll(new RegExp(`AppError\\.(?:forbidden|unauthenticated)\\(\\s*${str}`, 'g'))) keys.add(unescape(m[1], q));
      for (const m of s.matchAll(new RegExp(`AppError\\.notFound\\(\\s*${str}`, 'g'))) keys.add(`${unescape(m[1], q)} not found`);
      for (const m of s.matchAll(new RegExp(`\\bmessage:\\s*${str}`, 'g'))) keys.add(unescape(m[1], q));
      for (const m of s.matchAll(new RegExp(`\\.(?:min|max|regex|length|email|url|refine|nonempty)\\([^()]*(?:\\([^()]*\\)[^()]*)*?,\\s*${str}\\s*\\)`, 'g'))) keys.add(unescape(m[1], q));
    }
  }
  for (const k of ['Resource not found', 'You do not have permission to perform this action', 'Authentication required']) keys.add(k);
  return keys;
}

/** Display labels shared with the API (EVENT_KIND_LABELS…), shown through `| t`. */
async function contractLabels() {
  const keys = new Set();
  const mod = await import(pathToFileURL(join(repo, 'contracts', 'dist', 'index.js')).href);
  const walk = (v) => {
    if (typeof v === 'string') keys.add(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const [name, value] of Object.entries(mod)) if (/_LABELS$/.test(name)) walk(value);
  return keys;
}

async function extract() {
  const keys = new Set();
  for (const f of files(appDir, (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'))) for (const k of marked(readFileSync(f, 'utf8'))) keys.add(k);
  for (const k of await contractLabels()) keys.add(k);
  for (const k of apiMessages()) keys.add(k);
  const sorted = [...keys].filter((k) => /[A-Za-z]/.test(k)).sort((a, b) => a.localeCompare(b, 'en'));
  writeFileSync(keysFile, `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`${sorted.length} texts → ${relative(root, keysFile)}`);
}

const placeholders = (s) =>
  // `{name}` and `{name, plural|select|number …}`; words that open a plural branch (`{photo, story…}`) are not placeholders.
  [...s.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?=\}|,\s*(?:plural|select|selectordinal|number|date|time)\b)/g)].map((m) => m[1]).filter((n, i, a) => a.indexOf(n) === i).sort().join(',');

function check() {
  const keys = JSON.parse(readFileSync(keysFile, 'utf8'));
  let failed = false;
  for (const name of readdirSync(catalogsDir).filter((n) => n.endsWith('.json'))) {
    const catalog = JSON.parse(readFileSync(join(catalogsDir, name), 'utf8'));
    const missing = keys.filter((k) => !(k in catalog) || typeof catalog[k] !== 'string' || !catalog[k].trim());
    const stale = Object.keys(catalog).filter((k) => !keys.includes(k));
    const broken = keys.filter((k) => typeof catalog[k] === 'string' && catalog[k] && placeholders(k) !== placeholders(catalog[k]));
    const unbalanced = keys.filter((k) => typeof catalog[k] === 'string' && (catalog[k].match(/\{/g)?.length ?? 0) !== (catalog[k].match(/\}/g)?.length ?? 0));
    console.log(`${name}: ${keys.length - missing.length}/${keys.length} translated${stale.length ? `, ${stale.length} no longer used` : ''}`);
    for (const k of missing.slice(0, 20)) console.log(`  missing: ${JSON.stringify(k)}`);
    if (missing.length > 20) console.log(`  … and ${missing.length - 20} more missing`);
    for (const k of broken) console.log(`  placeholders differ: ${JSON.stringify(k)} → ${JSON.stringify(catalog[k])}`);
    for (const k of unbalanced) console.log(`  unbalanced braces: ${JSON.stringify(catalog[k])}`);
    if (missing.length || broken.length || unbalanced.length) failed = true;
  }
  if (failed) process.exit(1);
}

/** Removes `{{ … }}`, skipping braces inside quoted strings (ICU plurals contain `}}`). */
function stripInterpolations(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{{', i);
    if (open < 0) return out + text.slice(i);
    out += text.slice(i, open);
    let j = open + 2;
    let quote = null;
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"') quote = c;
      else if (c === '}' && text[j + 1] === '}') break;
    }
    out += blank(text.slice(open, Math.min(j + 2, text.length)));
    i = j + 2;
  }
  return out;
}

/** Replaces a match by spaces, keeping its line breaks (so line numbers stay right). */
const blank = (text) => text.replace(/[^\n]/g, ' ');

/**
 * Text in templates that is not marked. Comments, inline SVG, interpolations, control flow and tags are removed
 * (also when they span several lines); what is left must not contain words. Lines marked
 * `<!-- i18n-ignore -->` are skipped.
 */
export function untranslated(source) {
  const problems = [];
  for (const m of source.matchAll(/template:\s*`((?:\\.|[^`\\])*)`/g)) {
    const start = source.slice(0, m.index).split('\n').length;
    const original = m[1].split('\n');
    const ignored = new Set(original.flatMap((line, i) => (line.includes('i18n-ignore') ? [i] : [])));
    let t = m[1].replace(/<!--[\s\S]*?-->/g, blank).replace(/<svg\b[\s\S]*?<\/svg>/g, blank);
    // Text attributes that should be bound through the t pipe.
    for (const a of t.matchAll(/\s(placeholder|aria-label|title|alt|label|ariaLabel)="([^"]*)"/g)) {
      const line = t.slice(0, a.index).split('\n').length - 1;
      if (/[A-Za-z]{2,}/.test(a[2]) && !ignored.has(line)) problems.push({ line: start + line, text: `${a[1]}="${a[2]}"` });
    }
    t = stripInterpolations(t);
    t = t
      .replace(/@(?:if|else if|for|switch|case|defer)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)\s*\{?/g, blank)
      .replace(/@let\b[^;]*;/g, blank)
      // Tags, with quoted attribute values that may contain ">" (e.g. [disabled]="page >= last").
      .replace(/<[a-zA-Z/!][^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>/g, blank)
      .replace(/@(else|default|empty|placeholder|loading)\b/g, '     ')
      .replace(/&[a-z]+;|&#\d+;/g, ' ');
    t.split('\n').forEach((line, i) => {
      if (ignored.has(i)) return;
      const words = line.replace(/[{}()·→←↑↓—–\-•×✓✗%:,.;!?/|+*#&'"“”‘’…0-9\s]/g, ' ').trim();
      if (/[A-Za-z]{2,}/.test(words)) problems.push({ line: start + i, text: original[i].trim() });
    });
  }
  return problems;
}

function lint() {
  let count = 0;
  for (const f of files(appDir, (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'))) {
    for (const p of untranslated(readFileSync(f, 'utf8'))) {
      count++;
      console.log(`${relative(root, f)}:${p.line}: ${p.text.slice(0, 140)}`);
    }
  }
  console.log(count ? `${count} untranslated text(s)` : 'No untranslated text found in templates');
  if (count) process.exit(1);
}

const command = process.argv[2];
if (command === 'extract') await extract();
else if (command === 'check') check();
else if (command === 'lint') lint();
else if (command) {
  console.error('Usage: i18n.mjs extract | check | lint');
  process.exit(2);
}
