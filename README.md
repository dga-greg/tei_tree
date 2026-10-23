# Family Heritage — Family Tree & Generational History

A platform for families to document their ancestry, preserve their history and explore relationships across unlimited generations. The founding ancestor is **Generation 1**; every verified descendant's generation is calculated automatically.

> **Status: all eight phases complete.** Authentication and roles; families, people and relationships with privacy and integrity checks; automatic generation numbers with conflict review and dashboards; an interactive D3 family tree with search, highlighting, export and branches; a relationship finder that names how any two relatives are related and shows the path; invitations, suggestions with moderator review, profile claims, roles and a change history with undo; a family archive of photos, documents and recordings, stories and oral histories, and a family timeline; GEDCOM/JSON export, account and family deletion, abuse reports, a security review, performance checks, an end-to-end suite, container images and CI/CD.
>
> **Second roadmap (phases 9–14) complete:** GEDCOM import with matching against people already in the family and undo; a duplicate finder and field-by-field merging with undo; a family calendar of birthdays, anniversaries, remembrance days and events, a weekly e-mail and morning phone notifications, and an installable app that opens offline; lineage (abusua, ntoro or clan, and totems) inherited through mothers and fathers and shown in the tree; ceremonies with programmes and roles; family funds with dues, contributions and treasurers; places on a map with the family's moves between them, people tagged in photos, and transcripts and translations of recordings; two-step sign-in with an authenticator app and sign-in with Google; a printable family book (PDF) and the interface in English and French, with draft Twi, Ga, Ewe and Hausa translations. See the [roadmap](docs/07-ROADMAP.md) and the phase reports in [docs/](docs/).

## Documentation

| | |
|---|---|
| [01 — Architecture](docs/01-ARCHITECTURE.md) | Requirements analysis, architectural decisions, runtime architecture, folder structure |
| [02 — Data model](docs/02-DATA-MODEL.md) | MongoDB collections, the genealogy graph, integrity rules, indexes |
| [03 — Permissions](docs/03-PERMISSIONS.md) | Roles and the permission matrix |
| [04 — Generation & relationship engines](docs/04-GENERATION-ENGINE.md) | Generation calculation, conflicts, kinship classification |
| [05 — REST API](docs/05-API.md) | Conventions and every endpoint, with implementation status |
| [06 — UI architecture](docs/06-UI-ARCHITECTURE.md) | Component tree, state, HTTP layer, tree visualisation design |
| [07 — Roadmap](docs/07-ROADMAP.md) | Phases and exit criteria |
| [Deployment](docs/DEPLOYMENT.md) | Container images, configuration, operations |
| [Security review](docs/SECURITY-REVIEW.md) | What was checked, fixed and accepted |

## Stack

Angular 21 (standalone, signals, zoneless) · Tailwind CSS 4 · Angular CDK · Lucide — Node.js 22 · Express 5 · TypeScript · MongoDB 7 (Mongoose) · Redis · BullMQ · Argon2id · Zod. Shared types and the permission matrix live in the `@fh/contracts` workspace package.

## Getting started

Requirements: Node.js ≥ 22.12, npm 11 (`npm i -g npm@11`; npm 10 crashes on this workspace layout), Docker (for MongoDB, Redis and MailPit) or your own instances.

```bash
npm install
docker compose up -d                       # MongoDB replica set, Redis, MailPit (http://localhost:8025)
cp backend/.env.example backend/.env       # then replace both secrets
npm run build:contracts

npm run dev:api        # API on http://localhost:3000
npm run dev:worker     # background jobs (e-mail)
npm run dev:web        # web app on http://localhost:4200 (proxies /api to the API)
```

Create the first super administrator (cannot be done through the API):

```bash
cd backend
SUPER_ADMIN_PASSWORD='a long passphrase here' npm run create-super-admin -- --email you@example.org --name "Your Name"
```

### Tests

```bash
npm test               # contracts + backend (real MongoDB replica set) + frontend
```

Backend tests start MongoDB through `mongodb-memory-server`, which downloads a `mongod` binary on first use. If downloads are blocked, point it at a local binary: `MONGOMS_SYSTEM_BINARY=/path/to/mongod npm test`.

```bash
npm run e2e            # Playwright journeys against the real API and web app (starts both itself)
npm run perf -w backend   # seeds a 20 000-person family and checks response-time budgets
```

The end-to-end suite needs Chromium for Playwright (`npx playwright install chromium` in `e2e/`).

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In short: CI publishes an API/worker image and a web image (nginx serving the app and proxying `/api`); `deploy/docker-compose.yml` runs the whole stack with MongoDB, Redis, MinIO and Mailpit.

- Serve the SPA and the API from the **same origin** (e.g. `https://heritage.example.org` and `https://heritage.example.org/api`) behind a reverse proxy that terminates TLS. The auth cookies are `SameSite=Strict` and Angular only sends the CSRF header to same-origin URLs. Set `TRUST_PROXY` to the number of proxy hops.
- Production requires `REDIS_URL`, `SMTP_URL`, an `https://` `APP_ORIGIN` and secure cookies; the API refuses to start otherwise.
- Run at least one worker (`npm run start:worker` in `backend/`) alongside the API.
- MongoDB must be a replica set (Atlas clusters are).
