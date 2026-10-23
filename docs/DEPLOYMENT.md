# Deployment

> **Heroku:** see [HEROKU.md](HEROKU.md): one app serves both the site and the API (`WEB_DIST_DIR`), plus a worker dyno.

The application ships as two container images, built and published by CI:

| Image | Contents | Runs as |
|---|---|---|
| `ghcr.io/<owner>/<repo>-api` | API (`node backend/dist/server.js`) and, with another command, the background worker (`node backend/dist/worker.js`) | non-root `node`, port 3000 |
| `ghcr.io/<owner>/<repo>-web` | the built web app on nginx, which also proxies `/api` to the API | non-root, port 8080 |

Images are tagged with the branch name, the short commit and, for `v*` tags, the version. They are pushed for
commits to `main` and for version tags, after the checks, the end-to-end suite and a smoke test of the whole
stack (built from those images) have passed.

## Services it needs

| Service | Notes |
|---|---|
| MongoDB 7 **replica set** | Transactions require a replica set (a single node is fine). |
| Redis 7 | Rate limits shared between API instances, e-mail queue, generation queue and the scheduled purge. Required in production. |
| S3-compatible object storage | AWS S3, Cloudflare R2, SeaweedFS, MinIO… The bucket must stay **private**; the API hands out presigned links. |
| SMTP | Account e-mails, invitations, review decisions. |
| TLS terminator | Load balancer or reverse proxy in front of `web`; it should send `Strict-Transport-Security`. |

## Try the whole stack locally

```sh
cp deploy/.env.example deploy/.env      # set the secrets marked CHANGE
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
node deploy/smoke-test.mjs http://localhost:8080
```

The app is at http://localhost:8080 and e-mails at http://localhost:8025 (Mailpit). Files are stored in
SeaweedFS, an S3-compatible server, on http://localhost:8333. Create the first platform administrator with:

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -e SUPER_ADMIN_PASSWORD='…' api \
  node backend/dist/scripts/create-super-admin.js --email you@example.org --name "Your Name"
```

Sign in as that administrator and turn on two-step sign-in in **Settings → Security** (an authenticator app on your
phone) — the administration pages stay closed until you do.

## Configuration (API and worker)

The API refuses to start in production without the essentials (`backend/src/config/env.ts` validates
everything at start-up).

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV` | | `production` |
| `APP_ORIGIN` | ✅ | Public address of the web app, `https://…` in production (used in e-mail links). |
| `MONGODB_URI` | ✅ | Replica-set connection string. |
| `REDIS_URL` | ✅ | |
| `JWT_ACCESS_SECRET`, `CSRF_SECRET` | ✅ | 32+ random characters each. |
| `COOKIE_SECURE` | | Defaults to `true` in production; must not be `false` there. |
| `ALLOW_INSECURE_HTTP` | | Only for trying the stack on `http://localhost`: permits a plain-HTTP `APP_ORIGIN` and non-secure cookies (logged as a warning). Never on a public server. |
| `TRUST_PROXY` | | Number of proxies in front of the API (`1` behind the web container, `2` with a load balancer in front). |
| `SMTP_URL`, `MAIL_FROM` | ✅ (SMTP_URL) | e.g. `smtps://user:pass@smtp.example.org:465` |
| `STORAGE_DRIVER` | ✅ | `s3` in production. |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | ✅ | |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | | For non-AWS stores (R2, SeaweedFS, MinIO). |
| `S3_PUBLIC_ENDPOINT` | | Address browsers fetch files from, when it differs from `S3_ENDPOINT`. |
| `S3_SERVER_SIDE_ENCRYPTION` | | `AES256` or `aws:kms` to request encryption per object. AWS S3 and R2 encrypt at rest by default; leave unset for stores that do not support the header. |
| `MEDIA_MAX_UPLOAD_MB` | | Default 50. Keep below the web container's `MAX_UPLOAD_SIZE`. |
| `MEDIA_URL_TTL_SECONDS` | | Lifetime of signed file links, default 300. |
| `FAMILY_DELETION_GRACE_DAYS`, `MEDIA_RETENTION_DAYS` | | Default 30 each. |
| `MFA_ENCRYPTION_KEY` | recommended | 32+ random characters that encrypt authenticator-app secrets and key the recovery-code hashes. Defaults to a key derived from `JWT_ACCESS_SECRET` — set it so the two can change independently. Keep it: a new key makes every authenticator secret unreadable (people then need their recovery codes, or an administrator to turn two-step sign-in off in the database). |
| `ADMIN_MFA_REQUIRED` | | `true` (default): platform administrators must turn on two-step sign-in before the administration pages work. |
| `MFA_ISSUER` | | Name shown in authenticator apps (default `Family Heritage`). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | "Continue with Google". In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** of type *Web application*, with the authorised redirect URI `<APP_ORIGIN>/api/v1/auth/google/callback` (e.g. `https://family.example.org/api/v1/auth/google/callback`; for local development `http://localhost:4200/api/v1/auth/google/callback`). The consent screen needs only the `openid`, `email` and `profile` scopes. Without these settings the button is not shown. |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` | | Phone notifications (Web Push). Make a pair once with `npm run vapid -w backend` and keep it: new keys sign every device out of notifications. Without them notifications are off and the app does not offer them. |
| `WEB_PUSH_SUBJECT` | | Contact for push services (`mailto:` or `https:`); defaults to the `MAIL_FROM` address. |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION`, `MAP_TILE_MAX_ZOOM` | | Street maps on the Places page: a tile URL such as `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, its required credit, and the deepest zoom. Without it the page draws places to scale on a plain background. OpenStreetMap's own tiles are for light use only (see their tile usage policy); for a busy site use a tile provider's plan. Also set **`MAP_TILE_ORIGINS`** on the web container (e.g. `https://tile.openstreetmap.org`) so the Content-Security-Policy allows the tiles. |
| `TRANSCRIPTION_URL`, `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_MODEL`, `TRANSCRIPTION_MAX_MB` | | Automatic transcripts: an OpenAI-compatible `…/audio/transcriptions` endpoint (OpenAI, or a self-hosted Whisper server speaking the same API), its key, the model (default `whisper-1`) and the largest recording sent (default 25 MB). Translations into English use `…/audio/translations`. Runs on the worker's `transcriptions` queue (inline without Redis). Recordings are sent to that service, so tell the family which one you use. Without it, transcripts can still be typed. |
| `REMINDER_HOUR` | | Local hour (default 7) at which the weekly e-mail and the morning notification go out, in each person's own time zone. |
| `GENERATION_INLINE_LIMIT` | | Families larger than this are recalculated by the worker (default 2 000). |
| `RATE_LIMIT_*`, `LOGIN_*`, `ARGON2_*` | | See `backend/.env.example`. |

## Configuration (web)

| Variable | Default | Meaning |
|---|---|---|
| `API_UPSTREAM` | `http://api:3000` | Where nginx sends `/api`. |
| `MEDIA_ORIGINS` | empty | Origin(s) of the object store's signed links, e.g. `https://media.example.org` or `https://<bucket>.s3.<region>.amazonaws.com`, added to the CSP's `img-src` and `media-src`. |
| `MAX_UPLOAD_SIZE` | `60m` | nginx request-size ceiling for uploads. |

## Operations

- **Health**: `GET /health/live` (process up), `GET /health/ready` (MongoDB and Redis connected); the web
  container answers `GET /healthz`.
- **Scaling**: the API is stateless; run several behind the web/load balancer. Run at least one worker.
- **Family books** are made by the worker on the `books` queue, one at a time (inline in the API without Redis). A
  book reads every photo it includes from storage, so a large family's book takes a minute or two and some
  memory (roughly 200–400 MB while it runs). The fonts it uses (Noto Serif and Noto Sans, subset to Latin and the
  letters of Twi, Ga, Ewe and Hausa; SIL Open Font License) ship in the API image under `backend/assets/fonts`.
- **Languages**: the interface's translations are static files (`/i18n/<code>.json`) served with the web app; see
  [I18N.md](I18N.md) to add or review a language.
- **Scheduled purge**: the worker erases families past their deletion grace period and removed files past
  retention every 6 hours. Without a worker, run `node backend/dist/scripts/purge.js` from cron.
- **Reminders**: every hour the worker sends the weekly e-mail and the morning notifications that are due in
  each person's time zone (each at most once: delivery records). Without a worker, run
  `node backend/dist/scripts/reminders.js` hourly from cron.
- **Installable app**: the web image includes a service worker that caches the app itself (never family data),
  so it opens offline and can be installed on phones and computers. Browsers require HTTPS for this (localhost
  excepted). The service worker, `ngsw.json`, the manifest and icons are served with `Cache-Control: no-cache`
  so new releases reach installed apps.
- **Indexes**: created at API start-up.
- **Backups**: back up MongoDB (e.g. `mongodump` or managed snapshots) and the bucket (versioning or
  replication). Families can also download their own GEDCOM/JSON copies.
- **Logs**: JSON on stdout (pino). Cookies, CSRF tokens, passwords and signed file links are redacted.
- **Releases**: tag `vX.Y.Z` on `main`; CI publishes `X.Y.Z` images. Roll out the API and worker together.
