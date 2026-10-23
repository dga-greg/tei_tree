import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { webSources } from '../src/infra/web.js';
import { buildApp, testEnv, type TestContext } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'fh-web-'));
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Family Heritage</title>');
writeFileSync(join(dir, 'chunk-ABC123.js'), 'console.log(1)');
writeFileSync(join(dir, 'ngsw-worker.js'), '/* sw */');
mkdirSync(join(dir, 'i18n'));
writeFileSync(join(dir, 'i18n', 'fr.json'), '{}');

const apps: TestContext[] = [];
const app = (env: Record<string, string> = {}) => {
  const ctx = buildApp({ WEB_DIST_DIR: dir, MAP_TILE_URL: 'https://{s}.tile.example.org/{z}/{x}/{y}.png', ...env });
  apps.push(ctx);
  return ctx.instance.app;
};
afterAll(async () => {
  for (const c of apps) await c.instance.close();
});

describe('serving the web app from the API', () => {
  it('serves the app for page addresses, with the page security headers', async () => {
    const a = app();
    for (const path of ['/', '/members/123', '/auth/two-step']) {
      const res = await request(a).get(path).set('Accept', 'text/html');
      expect(res.status).toBe(200);
      expect(res.text).toContain('<title>Family Heritage</title>');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['content-security-policy']).toContain("script-src 'self'");
      expect(res.headers['content-security-policy']).toContain('https://*.tile.example.org');
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
  });

  it('caches build files for a year, revalidates the service worker and catalogs, and 404s missing files', async () => {
    const a = app();
    expect((await request(a).get('/chunk-ABC123.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(a).get('/ngsw-worker.js')).headers['cache-control']).toBe('no-cache');
    expect((await request(a).get('/i18n/fr.json')).headers['cache-control']).toBe('no-cache');
    expect((await request(a).get('/chunk-GONE.js')).status).toBe(404);
  });

  it('leaves the API as it was', async () => {
    const a = app();
    const res = await request(a).get('/api/v1/nope').set('Accept', 'text/html');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect((await request(a).get('/health/live')).body).toEqual({ status: 'ok' });
  });

  it('allows images and recordings from the object store', () => {
    const s = webSources(testEnv({ STORAGE_DRIVER: 's3', S3_BUCKET: 'media', S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com' }));
    expect(s.media).toEqual(['https://acc.r2.cloudflarestorage.com', 'https://*.acc.r2.cloudflarestorage.com']);
  });

  it('lets the service worker fetch media, map tiles and fonts (its fetches count as connections)', async () => {
    const a = app({
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'media',
      S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      MAP_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    });
    const csp = (await request(a).get('/').set('Accept', 'text/html')).headers['content-security-policy'];
    expect(csp).toContain("connect-src 'self' https://acc.r2.cloudflarestorage.com https://*.acc.r2.cloudflarestorage.com https://tile.openstreetmap.org https://fonts.gstatic.com;");
  });
});
