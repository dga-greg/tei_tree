/**
 * Smoke test of a running stack, through the web container (nginx → API → MongoDB/Redis/S3):
 *   node deploy/smoke-test.mjs http://localhost:8080
 * Signs up, registers a family, uploads a photo and fetches it through its signed link.
 */
import { deflateSync } from 'node:zlib';

const base = process.argv[2] ?? 'http://localhost:8080';
const jar = new Map();
let step = 0;

function check(condition, message) {
  step++;
  if (!condition) {
    console.error(`✗ ${step}. ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${step}. ${message}`);
}

async function call(method, path, body, { raw = false, redirect = 'follow' } = {}) {
  const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (jar.has('XSRF-TOKEN')) headers['x-xsrf-token'] = decodeURIComponent(jar.get('XSRF-TOKEN'));
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, redirect });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return raw ? res : { status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

function png() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, sum]);
  };
  const size = 16;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push(x * 15, y * 15, Date.now() % 256);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const page = await fetch(base + '/');
check(page.status === 200 && (page.headers.get('content-security-policy') ?? '').includes("default-src 'self'"), 'web app is served with a Content-Security-Policy');
const html = await page.text();
// The policy allows no inline scripts, so the page must not contain any (they would silently not run).
check(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) && !/\son[a-z]+\s*=/i.test(html), 'the page has no inline scripts or event handlers the policy would block');
// Installable app: manifest and service worker served, never cached for long (so releases reach installed apps).
const manifest = await fetch(base + '/manifest.webmanifest');
check(manifest.status === 200 && (manifest.headers.get('content-type') ?? '').includes('application/manifest+json') && (await manifest.json()).display === 'standalone', 'the web app manifest is served');
const sw = await fetch(base + '/ngsw-worker.js');
check(sw.status === 200 && sw.headers.get('cache-control') === 'no-cache' && (await fetch(base + '/ngsw.json')).status === 200, 'the service worker is served and revalidated on every release');
const icon = await fetch(base + '/icons/icon-192.png');
check(icon.status === 200 && icon.headers.get('content-type') === 'image/png', 'app icons are served');
const deep = await fetch(base + '/members/123');
check(deep.status === 200 && (await deep.text()).includes('<fh-root'), 'deep links fall back to the app');

check((await call('GET', '/api/v1/auth/csrf')).status === 200 && jar.has('XSRF-TOKEN'), 'API reachable through the proxy, CSRF cookie issued');
const email = `smoke.${Date.now()}@example.org`;
const reg = await call('POST', '/api/v1/auth/register', { email, password: 'a long smoke-test password', displayName: 'Smoke Test' });
check(reg.status === 201 && jar.has('fh_access'), 'sign up');
const fam = await call('POST', '/api/v1/families', { name: 'Smoke Family', founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased' } });
check(fam.status === 201, 'register a family (MongoDB transactions work)');
const familyId = fam.body.data.id;

const form = new FormData();
form.append('title', 'Smoke photo');
form.append('file', new Blob([png()], { type: 'image/png' }), 'smoke.png');
const up = await call('POST', `/api/v1/families/${familyId}/media`, form);
check(up.status === 201 && up.body.data.kind === 'photo', 'upload a photo (re-encoded and stored in object storage)');

const redirect = await call('GET', up.body.data.urls.original, undefined, { raw: true, redirect: 'manual' });
const location = redirect.headers.get('location');
check(redirect.status === 302 && !!location, 'file request redirects to a signed link');
const file = await fetch(new URL(location, base));
const bytes = Buffer.from(await file.arrayBuffer());
check(file.status === 200 && file.headers.get('content-type') === 'image/png' && bytes.subarray(1, 4).toString() === 'PNG', 'the signed link serves the photo, intact');
const thumbRedirect = await call('GET', up.body.data.urls.thumb, undefined, { raw: true, redirect: 'manual' });
const thumb = Buffer.from(await (await fetch(new URL(thumbRedirect.headers.get('location'), base))).arrayBuffer());
check(thumb.subarray(0, 4).toString() === 'RIFF' && thumb.subarray(8, 12).toString() === 'WEBP', 'the thumbnail is a valid WebP image');

const timeline = await call('GET', `/api/v1/families/${familyId}/timeline`);
check(timeline.status === 200, 'timeline');
const calendar = await call('GET', `/api/v1/families/${familyId}/calendar?from=2026-01-01&to=2026-12-31`);
check(calendar.status === 200 && Array.isArray(calendar.body.data), 'family calendar');
console.log('Smoke test passed.');
