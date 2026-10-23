import { pino, type Logger } from 'pino';

/** Signed file links are short-lived credentials: keep them out of logs. */
export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(/(\/api\/v1\/files\/)[^/?#]+/, '$1[redacted]');
}

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-xsrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
        '*.token',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  });
}

export type { Logger };
