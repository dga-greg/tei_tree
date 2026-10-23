// Draws the app icons from the logo (run from the repository root: node frontend/scripts/make-icons.mjs).
// Uses sharp from the backend workspace. Output: frontend/public/icons/*.png
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const sharp = require('sharp');

const out = new URL('../public/icons/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const mark = (strokeTrunk = '#f0cf6b', branch = '#dcede1', dot1 = '#f0cf6b', dot2 = '#bbdcc6', dot3 = '#8ec3a2') => `
  <path d="M20 31V12" stroke="${strokeTrunk}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
  <path d="M20 18l-7-5M20 18l7-5M20 24l-8-3M20 24l8-3" stroke="${branch}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <circle cx="20" cy="10" r="2.6" fill="${dot1}"/><circle cx="12" cy="12.5" r="2" fill="${dot2}"/><circle cx="28" cy="12.5" r="2" fill="${dot2}"/>
  <circle cx="11" cy="20.5" r="1.8" fill="${dot3}"/><circle cx="29" cy="20.5" r="1.8" fill="${dot3}"/>`;

// Rounded tile, as in the app.
const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#14532d"/>${mark()}</svg>`;
// Maskable: full-bleed background, the mark inside the central safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#14532d"/><g transform="translate(20 20) scale(0.72) translate(-20 -20.5)">${mark()}</g></svg>`;
// Badge: white silhouette on transparent (Android shows it in the status bar).
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g transform="translate(20 20) scale(1.15) translate(-20 -20.5)">${mark('#fff', '#fff', '#fff', '#fff', '#fff')}</g></svg>`;

const render = (svg, size, file) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(out + file);
await render(any, 192, 'icon-192.png');
await render(any, 512, 'icon-512.png');
await render(maskable, 512, 'maskable-512.png');
await render(maskable, 180, 'apple-touch-icon.png');
await render(badge, 72, 'badge-72.png');
console.log('Icons written to', out);
