import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /**
     * Serve the built web app from the API too (one address for both, e.g. on Heroku):
     * the folder with index.html, e.g. frontend/dist/frontend/browser. Unset when a separate web server (nginx) serves it.
     */
    WEB_DIST_DIR: z.string().optional().transform((v) => (v ? v : undefined)),
    APP_ORIGIN: z.url(),

    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.string().optional().transform((v) => (v ? v : undefined)),
    /** `false` for managed Redis with a self-signed certificate (Heroku Key-Value Store); still encrypted. */
    REDIS_TLS_VERIFY: bool.default(true),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),

    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    SESSION_MAX_LIFETIME_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    /** Sign out after this long without activity, unless "Keep me signed in" was ticked. 0 turns it off. */
    IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(30),
    COOKIE_SECURE: bool.optional(),
    /** Only for trying a production build on http://localhost: allows a plain-HTTP origin and non-secure cookies. */
    ALLOW_INSECURE_HTTP: bool.optional(),

    ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),

    RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_AUTH_PER_15_MINUTES: z.coerce.number().int().min(1).default(10),

    /** Families with more people than this are recalculated by the background worker. */
    GENERATION_INLINE_LIMIT: z.coerce.number().int().min(0).default(2000),

    /** Where uploaded files live: `local` (a directory, development) or `s3` (any S3-compatible store). */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    MEDIA_LOCAL_DIR: z.string().default('./var/media'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().optional().transform((v) => (v ? v : undefined)),
    /** Address browsers use to fetch files, when it differs from S3_ENDPOINT (e.g. an S3 server inside Docker). */
    S3_PUBLIC_ENDPOINT: z.string().optional().transform((v) => (v ? v : undefined)),
    S3_FORCE_PATH_STYLE: bool.optional(),
    /**
     * Ask the store to encrypt objects (`AES256` or `aws:kms`). AWS S3 and R2 already encrypt everything at rest;
     * some S3-compatible servers mishandle the header, so it is only sent when set.
     */
    S3_SERVER_SIDE_ENCRYPTION: z.enum(['AES256', 'aws:kms']).optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** Signs local file links; defaults to a key derived from JWT_ACCESS_SECRET. */
    MEDIA_SIGNING_SECRET: z.string().min(32).optional(),
    MEDIA_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(50),
    /** Lifetime of the signed links files are served through. */
    /** Days a deleted family can be restored before it is erased. */
    FAMILY_DELETION_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(30),
    /** Days removed files stay restorable before their stored objects are deleted. */
    MEDIA_RETENTION_DAYS: z.coerce.number().int().min(0).max(365).default(30),
    MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

    SMTP_URL: z.string().optional().transform((v) => (v ? v : undefined)),
    MAIL_FROM: z.string().default('Family Heritage <no-reply@localhost>'),

    /** Automatic transcripts: an OpenAI-compatible speech-to-text endpoint (OpenAI Whisper, or a self-hosted Whisper server). */
    TRANSCRIPTION_URL: z.url().optional().or(z.literal('').transform(() => undefined)),
    TRANSCRIPTION_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
    TRANSCRIPTION_MODEL: z.string().default('whisper-1'),
    /** Largest recording sent for transcription (OpenAI accepts 25 MB). */
    TRANSCRIPTION_MAX_MB: z.coerce.number().int().min(1).max(1000).default(25),
    /** Base map for the places map, e.g. https://tile.openstreetmap.org/{z}/{x}/{y}.png (add its origin to the web image's MAP_TILE_ORIGINS). */
    MAP_TILE_URL: z.string().optional().transform((v) => (v ? v : undefined)),
    MAP_TILE_ATTRIBUTION: z.string().default('© OpenStreetMap contributors'),
    MAP_TILE_MAX_ZOOM: z.coerce.number().int().min(1).max(22).default(18),
    /**
     * Encrypts authenticator secrets and keys recovery codes. Defaults to a key derived from JWT_ACCESS_SECRET;
     * set it explicitly so the secrets can be rotated independently (changing it turns two-step sign-in off for everyone).
     */
    MFA_ENCRYPTION_KEY: z.string().min(32, 'MFA_ENCRYPTION_KEY must be at least 32 characters').optional().or(z.literal('').transform(() => undefined)),
    /** Name shown in authenticator apps. */
    MFA_ISSUER: z.string().min(1).max(60).default('Family Heritage'),
    /** Platform administrators must turn on two-step sign-in before using the administration pages. */
    ADMIN_MFA_REQUIRED: bool.default(true),
    /** "Continue with Google": an OAuth client (Web application) whose redirect URI is <APP_ORIGIN>/api/v1/auth/google/callback. */
    GOOGLE_CLIENT_ID: z.string().optional().transform((v) => (v ? v : undefined)),
    GOOGLE_CLIENT_SECRET: z.string().optional().transform((v) => (v ? v : undefined)),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'required with STORAGE_DRIVER=s3' });
    if (!!env.GOOGLE_CLIENT_ID !== !!env.GOOGLE_CLIENT_SECRET) ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'set both Google client settings, or neither' });
    if (env.NODE_ENV !== 'production') return;
    if (!env.REDIS_URL) ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'required in production' });
    if (!env.SMTP_URL) ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'required in production' });
    if (env.STORAGE_DRIVER !== 's3') ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'must be s3 in production' });
    if (env.ALLOW_INSECURE_HTTP) return;
    if (env.COOKIE_SECURE === false)
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must not be false in production' });
    if (!env.APP_ORIGIN.startsWith('https://'))
      ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'must use https in production' });
  });

export type Env = z.infer<typeof EnvSchema> & { COOKIE_SECURE: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  return { ...env, COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production' };
}
