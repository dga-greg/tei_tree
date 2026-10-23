#!/usr/bin/env node
/**
 * After `ng build`: lets the browser start every start-up file at once.
 *
 * Angular adds `<link rel="modulepreload">` for at most 10 of the files the app needs to start, and the largest
 * (Angular itself, the icons) are often not among them, so the browser only finds them after the first ones have
 * arrived and run: a second round trip before anything shows. This adds the missing ones (every file `main` imports,
 * directly or through another), and updates the service worker's hash of index.html to match.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'frontend', 'browser');
const indexFile = join(dir, 'index.html');
let html = readFileSync(indexFile, 'utf8');

const main = readdirSync(dir).find((f) => /^main-[\w-]+\.js$/.test(f));
if (!main) throw new Error(`No main-*.js in ${dir}`);

/** Files a module imports statically (`import … from "./x.js"`, `import "./x.js"`), not `import()`. */
function staticImports(file) {
  const code = readFileSync(join(dir, file), 'utf8');
  return [...code.matchAll(/(?:^|[;}\s])import(?:[\s{][^;]*?from)?\s*["']\.\/([\w.-]+\.js)["']/g)].map((m) => m[1]);
}

const needed = new Set();
const queue = [main];
while (queue.length) {
  for (const file of staticImports(queue.shift())) {
    if (!needed.has(file)) {
      needed.add(file);
      queue.push(file);
    }
  }
}

const missing = [...needed].filter((f) => !html.includes(`href="${f}"`));
if (!missing.length) {
  console.log('modulepreload: every start-up file is already preloaded');
} else {
  const links = missing.map((f) => `<link rel="modulepreload" href="${f}">`).join('');
  const at = html.indexOf(`<script src="${main}"`);
  if (at < 0) throw new Error(`No <script> for ${main} in index.html`);
  html = html.slice(0, at) + links + html.slice(at);
  writeFileSync(indexFile, html);

  // The service worker refuses files whose content does not match its hash table.
  const ngswFile = join(dir, 'ngsw.json');
  if (existsSync(ngswFile)) {
    const ngsw = JSON.parse(readFileSync(ngswFile, 'utf8'));
    ngsw.hashTable['/index.html'] = createHash('sha1').update(html).digest('hex');
    writeFileSync(ngswFile, JSON.stringify(ngsw, null, 2));
  }
  console.log(`modulepreload: added ${missing.length} start-up file(s): ${missing.join(', ')}`);
}
