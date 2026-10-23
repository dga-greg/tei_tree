import { Router, type Request, type Response } from 'express';
import { contentDisposition, type LocalStorage } from '../../infra/storage.js';

/**
 * Serves files from local storage through signed links (development and tests; production uses S3 links).
 * The token carries the key, type and expiry and is HMAC-signed, so it cannot be altered or reused later.
 */
export function localFilesRoutes(storage: LocalStorage): Router {
  const router = Router();
  router.get('/:token', async (req: Request, res: Response) => {
    const token = storage.verify(String(req.params['token']));
    if (!token) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This link has expired or is invalid', requestId: req.requestId } });
      return;
    }
    const probe = await storage.open(token.file);
    if (!probe) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found', requestId: req.requestId } });
      return;
    }
    probe.stream.destroy();
    const size = probe.size;
    res.setHeader('Content-Type', token.t);
    res.setHeader('Content-Disposition', contentDisposition(token.d, token.n));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Files never run as pages of this site, even if a browser were persuaded to render one.
    res.setHeader('Content-Security-Policy', token.t === 'application/pdf' ? "default-src 'none'; object-src 'self'; plugin-types application/pdf" : "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      end = Math.min(end, size - 1);
      if (start > end || start >= size) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      start = Math.max(0, start);
      const part = await storage.open(token.file, { start, end });
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      part!.stream.pipe(res);
      return;
    }
    const whole = await storage.open(token.file);
    res.setHeader('Content-Length', String(size));
    whole!.stream.pipe(res);
  });
  return router;
}
