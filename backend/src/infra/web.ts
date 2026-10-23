import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { Router, type Response } from 'express';
import type { Env } from '../config/env.js';

/** The origin of a URL, also accepting tile templates like https://{s}.tile.example.org/{z}/{x}/{y}.png. */
function originOf(url: string | undefined): string[] {
  if (!url) return [];
  const wildcard = url.replace(/\{s\}\./, 'x-subdomain.');
  try {
    const u = new URL(wildcard.replace(/\{[^}]+\}/g, '0'));
    const host = u.host.replace(/^x-subdomain\./, '*.');
    return [`${u.protocol}//${host}`];
  } catch {
    return [];
  }
}

/**
 * Where the browser may load images and recordings from, besides the app: the object store (signed links point
 * at its endpoint, path-style or bucket subdomains) and the map tile service.
 */
export function webSources(env: Env): { media: string[]; tiles: string[] } {
  const store = env.STORAGE_DRIVER === 's3' ? originOf(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT) : [];
  const media = store.flatMap((o) => [o, o.replace('://', '://*.')]);
  if (env.STORAGE_DRIVER === 's3' && !env.S3_ENDPOINT && !env.S3_PUBLIC_ENDPOINT) media.push('https://*.amazonaws.com');
  return { media, tiles: originOf(env.MAP_TILE_URL) };
}

/** The same headers deploy/nginx.conf.template sets for the app's pages. */
function pageHeaders(res: Response, sources: { media: string[]; tiles: string[] }): void {
  const media = sources.media.join(' ');
  const images = [...sources.media, ...sources.tiles].join(' ');
  // The service worker fetches fonts, map tiles and media on the page's behalf, and its fetches count as connections.
  const connect = [...sources.media, ...sources.tiles, 'https://fonts.gstatic.com'].join(' ');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: ${images}; media-src 'self' blob: ${media}; connect-src 'self' ${connect}; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
}

/** Files whose names stay the same between releases: always revalidate, so new releases reach installed apps. */
const STABLE = /^\/(?:ngsw-worker\.js|safety-worker\.js|worker-basic\.min\.js|ngsw\.json|manifest\.webmanifest|i18n\/.+|icons\/.+)$/;
/** Fingerprinted build output. */
const HASHED = /\.(?:js|css|woff2?|ttf|svg|png|jpg|ico|webp)$/;

/**
 * Serves the built web app from the API itself (one address for both, e.g. on Heroku), with the security and
 * caching rules of the nginx image. Unknown paths outside /api get index.html, so app links work on reload.
 */
export function webRoutes(dir: string, env: Env): Router {
  const root = path.resolve(dir);
  if (!existsSync(path.join(root, 'index.html'))) throw new Error(`WEB_DIST_DIR has no index.html: ${root} (build the frontend first)`);
  const sources = webSources(env);
  const router = Router();
  router.use(
    express.static(root, {
      index: false,
      setHeaders: (res, file) => {
        const url = `/${path.relative(root, file).split(path.sep).join('/')}`;
        pageHeaders(res, sources);
        if (STABLE.test(url)) res.setHeader('Cache-Control', 'no-cache');
        else if (HASHED.test(url)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  router.get(/^(?!\/api\/|\/health\/).*/, (req, res, next) => {
    // Missing files (a stale chunk, a typo) are 404s, not the app.
    if (path.extname(req.path) || !req.accepts('html')) return next();
    pageHeaders(res, sources);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(root, 'index.html'));
  });
  return router;
}
