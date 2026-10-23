import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'a long e2e family password';
const MAIL_LOG = process.env['E2E_MAIL_LOG'] ?? join(import.meta.dirname, '..', '.output', 'api.log');

let counter = 0;
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now().toString(36)}${(counter++).toString(36)}@e2e.test`;
}

function mailLines(to: string, path: string): string[] {
  return readFileSync(MAIL_LOG, 'utf8').split('\n').filter((l) => l.includes(to) && l.includes(path));
}

/** How many e-mails to `to` containing `path` have been sent so far (to wait for a newer one). */
export function mailCount(to: string, path: string): number {
  return mailLines(to, path).length;
}

/**
 * The most recent link sent to `to` whose path contains `path` (the development mailer writes e-mails to
 * the API log). With `after`, waits for an e-mail newer than that count.
 */
export async function mailLink(to: string, path: string, after = 0): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const lines = mailLines(to, path);
    if (lines.length <= after) {
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    const match = lines.at(-1)?.match(new RegExp(`https?://[^\\s"\\\\]*${path}[^\\s"\\\\]*`));
    if (match) return new URL(match[0]).pathname + new URL(match[0]).search;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No e-mail to ${to} containing ${path}`);
}

/** Calls the API with the page's cookies and CSRF token, as the web app does. */
export function api(page: Page) {
  return async <T = unknown>(method: string, path: string, body?: unknown): Promise<T> => {
    const xsrf = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
    const res = await page.request.fetch(`/api/v1${path}`, { method, data: body as object, headers: { 'X-XSRF-TOKEN': xsrf } });
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
    return (res.status() === 204 ? null : ((await res.json()) as { data: T }).data) as T;
  };
}

/** Signs up through the form and confirms the e-mail address. */
export async function signUp(page: Page, name: string, email = uniqueEmail(name.split(' ')[0]!.toLowerCase())): Promise<string> {
  const before = mailCount(email, '/auth/verify-email');
  await page.goto('/auth/register');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/dashboard');
  await page.goto(await mailLink(email, '/auth/verify-email', before));
  await expect(page.getByText(/confirmed|verified/i).first()).toBeVisible();
  return email;
}

export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/auth/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

export interface SeededFamily {
  id: string;
  founder: string;
  people: Record<string, string>;
}

/** A small family created through the API: Kofi (founder) + Akosua, children Kwame and Ama, grandchildren Yaw and Abena. */
export async function seedFamily(page: Page, name = 'Mensah Family'): Promise<SeededFamily> {
  const call = api(page);
  const fam = await call<{ id: string; foundingMemberId: string }>('POST', '/families', {
    name,
    founder: { firstName: 'Kofi', surname: 'Mensah', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1885, qualifier: 'about' }, deathDate: { year: 1962 } },
  });
  const add = async (person: Record<string, unknown>, links?: Record<string, unknown>) =>
    (await call<{ id: string }>('POST', `/families/${fam.id}/members`, { person: { surname: 'Mensah', ...person }, links })).id;
  const parent = (...ids: string[]) => ({ parents: ids.map((memberId) => ({ memberId, subtype: 'biological', verification: 'verified' })) });
  const akosua = await add({ firstName: 'Akosua', surname: 'Owusu', gender: 'female', vitalStatus: 'deceased' }, { partners: [{ memberId: fam.foundingMemberId, subtype: 'marriage', verification: 'verified' }] });
  const kwame = await add({ firstName: 'Kwame', gender: 'male', vitalStatus: 'deceased', birthDate: { year: 1912 } }, parent(fam.foundingMemberId, akosua));
  const ama = await add({ firstName: 'Ama', gender: 'female', vitalStatus: 'deceased', birthDate: { year: 1915 } }, parent(fam.foundingMemberId, akosua));
  const yaw = await add({ firstName: 'Yaw', gender: 'male', vitalStatus: 'living', birthDate: { year: 1945 } }, parent(kwame));
  const abena = await add({ firstName: 'Abena', gender: 'female', vitalStatus: 'living', birthDate: { year: 1948 } }, parent(ama));
  return { id: fam.id, founder: fam.foundingMemberId, people: { kofi: fam.foundingMemberId, akosua, kwame, ama, yaw, abena } };
}

/** Tiny but valid files for upload tests. */
export const files = {
  png: (name = 'photo.png', seed = 0) => ({
    name,
    mimeType: 'image/png',
    // 2×2 PNG; `seed` changes one pixel so each file has a different hash.
    buffer: pngOf(seed),
  }),
  wav: (name = 'interview.wav') => {
    const rate = 8000;
    const n = rate;
    const b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + n * 2, 4);
    b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * 2, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36);
    b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 4000), 44 + i * 2);
    return { name, mimeType: 'audio/wav', buffer: b };
  },
};

import { deflateSync } from 'node:zlib';
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngOf(seed: number): Buffer {
  const size = 24;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows: number[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push((x * 10 + seed * 37) % 256, (y * 10) % 256, (seed * 53) % 256);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** The authenticator-app code for a base32 secret, `offset` 30-second steps from now (as the app would show). */
export function totp(secret: string, offset = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secret.replace(/\s/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const o = digest[digest.length - 1]! & 15;
  return ((digest.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
