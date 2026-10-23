# Running on Heroku

One Heroku app runs the whole site at one address: the API also serves the web pages (`WEB_DIST_DIR`), so sign-in
cookies and CSRF protection work exactly as on the Docker setup. A second process, the **worker**, sends e-mails
and makes family books and transcripts.

What you need (and keep using from your local setup):

| Piece | Service | Cost (roughly) |
|---|---|---|
| Web process (site + API) | Heroku **Basic** dyno | $7/month |
| Worker process | Heroku **Basic** dyno | $7/month |
| Redis (queues, rate limits) | [Upstash](https://upstash.com) free tier, or Heroku Key-Value Store | free / from $3 |
| Database | MongoDB Atlas | free tier to start |
| Photos and files | Cloudflare R2 | free up to 10 GB |
| E-mail | Resend | free up to 3 000/month |
| Your own domain (optional) | any registrar | ~$10–15/year |

Eco dynos ($5 for a pool of hours) sleep after 30 minutes without visits, and reminders and e-mails then wait, so
use Basic.

## 1. Create the app

Install the Heroku CLI (`brew tap heroku/brew && brew install heroku`), then from the `family_tree` folder:

```bash
heroku login
heroku create mensah-family          # pick your own name; the site will be https://mensah-family.herokuapp.com
heroku buildpacks:set heroku/nodejs
```

## 2. Redis

Easiest is **Upstash** (free): create a Redis database, copy its `rediss://…` URL, then:

```bash
heroku config:set REDIS_URL='rediss://default:PASSWORD@HOST.upstash.io:6379'
```

Or Heroku's own: `heroku addons:create heroku-redis:mini` (sets `REDIS_URL` itself), and then
`heroku config:set REDIS_TLS_VERIFY=false`, because its certificate is self-signed (the connection is still encrypted).

## 3. Settings

Replace every value in capitals; the rest can stay. Secrets: make each with `openssl rand -hex 32`.

```bash
heroku config:set \
  NODE_ENV=production \
  APP_ORIGIN=https://mensah-family.herokuapp.com \
  TRUST_PROXY=1 \
  WEB_DIST_DIR=frontend/dist/frontend/browser \
  MONGOMS_DISABLE_POSTINSTALL=1 \
  MONGODB_URI='mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/family_heritage' \
  JWT_ACCESS_SECRET=RANDOM_64_HEX \
  CSRF_SECRET=ANOTHER_RANDOM_64_HEX \
  MFA_ENCRYPTION_KEY=A_THIRD_RANDOM_64_HEX \
  STORAGE_DRIVER=s3 \
  S3_BUCKET=family-heritage-media \
  S3_REGION=auto \
  S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com \
  S3_FORCE_PATH_STYLE=true \
  S3_ACCESS_KEY_ID=R2_KEY_ID \
  S3_SECRET_ACCESS_KEY=R2_SECRET \
  SMTP_URL='smtps://resend:re_YOUR_KEY@smtp.resend.com:465' \
  MAIL_FROM='Family Heritage <no-reply@YOUR-VERIFIED-DOMAIN>'
```

You can copy the values from your `backend/.env`. Never commit that file. Keep `MFA_ENCRYPTION_KEY` once set:
changing it turns two-step sign-in off for everyone.

Ceremony announcements by SMS: `GIANT_AUTH` and `GIANT_SENDER_ID` (plus `GIANT_USERNAME`, `GIANT_PASSWORD`), and for WhatsApp `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`; see [MESSAGING.md](MESSAGING.md).

Optional, as on your laptop: `IDLE_TIMEOUT_MINUTES` (sign-out after this long without activity, default 30; 0 turns it off; people who tick "Keep me signed in on this device" are not affected), `MAP_TILE_URL`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (the redirect URI becomes
`https://mensah-family.herokuapp.com/api/v1/auth/google/callback`), `TRANSCRIPTION_URL` / `TRANSCRIPTION_API_KEY`,
`WEB_PUSH_PUBLIC_KEY` / `WEB_PUSH_PRIVATE_KEY`. Images, recordings and map tiles are allowed by the page's security
policy automatically, from `S3_ENDPOINT` and `MAP_TILE_URL`.

**MongoDB Atlas:** Heroku's addresses change, so in Atlas → Network Access allow `0.0.0.0/0` (access is still
protected by the database user and password), or use a fixed-IP add-on.

## 4. Deploy

```bash
git push heroku claude/eloquent-newton-q2l07l:main
heroku ps:scale web=1:basic worker=1:basic
heroku logs --tail
```

The build installs everything, builds the shared types, the API and the web app (`heroku-postbuild`), then starts
`web` and `worker` from the `Procfile`. Look for `API listening` and `Worker started` in the logs. Then open
`https://mensah-family.herokuapp.com`.

To deploy a new version later: `git pull`, then the same `git push heroku …` line.

## 5. First administrator

```bash
heroku run 'SUPER_ADMIN_PASSWORD="a long password" node backend/dist/scripts/create-super-admin.js --email you@example.org --name "Your Name"'
```

Sign in, then turn on two-step sign-in in Settings → Security (the administration pages need it).

## 6. Your own domain (optional)

```bash
heroku domains:add family.example.org
heroku certs:auto:enable
```

At your domain registrar, point `family.example.org` (a CNAME record) to the DNS target Heroku printed. Then update
`APP_ORIGIN` and the Google redirect URI to the new address. HTTPS certificates are automatic.

## Good to know

- **Uploads:** Heroku ends any request that takes more than 30 seconds, so very large videos on slow connections can
  fail; photos and documents are fine.
- **Backups:** turn on Atlas backups; R2 keeps the files.
- **Costs grow** with use only through Atlas, R2 and Resend tiers. The two Basic dynos are fixed.
