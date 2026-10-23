# Phase 8 — Hardening & deployment: what was built and how it was verified

## Delivered

**Data export**
- Family administrators download the whole family as **GEDCOM 5.5.1** (UTF-8, lineage-linked; opens in other
  genealogy programs) or as a complete **JSON** backup (people with every field, relationships, branches,
  events, stories, file details; no accounts, no internal fields). Fuzzy dates map to GEDCOM modifiers
  (`ABT`, `BEF`, `AFT`, `BET … AND …`, `EST`, date phrases); birth, adoptive and foster links become families
  with the right `PEDI`; customary marriages and civil unions keep their type. Optionally living people are
  replaced by "Living" for copies shared outside the family. Exports are recorded in the change history.
- Every account can download **everything held about it** (profile, memberships, suggestions, uploads,
  stories, devices, activity).

**Deletion workflows**
- **Account deletion** (password required): name, e-mail and password are erased, sessions end, memberships
  end, open suggestions are withdrawn and unpublished additions removed; contributions to family records stay
  with the family, shown as by a "Former member". Refused while the person is a family's only administrator
  (or the only platform administrator). The address can be used again.
- **Family deletion** (password and the family's exact name): the family closes for everyone at once; its
  administrators can restore it from their settings during a grace period (30 days by default), after which
  the **purge** erases every record and stored file. A platform audit entry records the purge.
- **Removed files** can be restored from the change history until the retention period ends; then the purge
  deletes the stored objects.
- The purge runs every 6 hours in the worker (BullMQ job scheduler), on a timer in the API when there is no
  Redis, or once from the command line (`purge.js`, for cron).

**Abuse reports** — anyone signed in can report a family, profile, file, story or event they can see (once per
item). Platform administrators review reports without access to family records: they see what was reported
(as named at the time), the reason and the description, and can ask the family's administrators to act
(e-mail), suspend the family, or dismiss; the reporter is told the outcome. Reports survive a family's purge.

**Security review** — see [SECURITY-REVIEW.md](SECURITY-REVIEW.md). Fixes: vulnerable jsPDF and nodemailer
upgraded (`npm audit`: 0); signed file links redacted from logs; JSON body limit raised to fit the longest
stories; production web headers (CSP and others). New automated checks: a sweep of all 75 family routes
(outsiders always get 404; malformed input never causes a server error), security headers, mass assignment,
query-operator injection.

**Performance** — `npm run perf -w backend` seeds a 20 000-person family and times the main endpoints against
budgets. It found two slow paths, both fixed:

| Operation (20 000 people) | Before | After | Budget (p95) |
|---|---|---|---|
| Relationship finder, warm | p50 275 ms / p95 354 ms | p50 23 ms / p95 36 ms | 150 ms |
| Member list, first page | p50 162 ms / p95 253 ms | p50 27 ms / p95 38 ms | 250 ms |

The finder now caches each family's built graph (links and names), invalidated by `graphRevision` and a new
`peopleRevision`; the member list uses an indexed find instead of an aggregation that sorted everyone. Other
results: tree root 111 ms, descendants (4 generations) 154 ms, search 60 ms, profile 31 ms, dashboard 335 ms,
timeline 75 ms (all p95); full generation recalculation 5.3 s and GEDCOM export 1.5 s for the whole family.

**End-to-end suite** (`e2e/`, Playwright) — 15 journeys against the real API and web app, each with fresh
accounts and a throwaway MongoDB: sign-up, verification, sign-in/out, return to the requested page; registering a
family with its founder, adding a child, generations and tree; relationship finder and path in the tree; search
and the integrity rules; invitation → acceptance → reviewed correction, **link correction and link removal
suggestions** (the gap noted in Phase 6), undo from the change history; profile claim and own-profile editing;
uploads, profile photo, duplicate refusal; events, oral history with a playable recording, timeline; member
uploads through review; GEDCOM/JSON/personal exports; family deletion and restore; reports resolved by a
platform administrator; account deletion; every main page on a phone screen without sideways overflow.

The suite found a real bug: suggestions created for uploads and stories had an empty payload, which Mongoose
drops on save, so **approving them failed after the item had already been published**. Fixed; the backend
tests now assert the approval responses (and fail without the fix).

**Containers and deployment**
- `backend/Dockerfile` — API and worker image (multi-stage, production dependencies only, non-root, health
  check). `frontend/Dockerfile` — the built app on unprivileged nginx with the Content-Security-Policy and other
  headers, SPA fallback, `/api` proxy with streamed uploads, long-term caching of fingerprinted files.
- `deploy/docker-compose.yml` — the whole stack: MongoDB replica set, Redis, S3-compatible storage
  (SeaweedFS) with its bucket created privately, Mailpit, API, worker and web. `deploy/smoke-test.mjs` checks a
  running stack end to end.
- Optional build-time CA certificate (BuildKit secret) for building behind TLS-intercepting proxies.
- [DEPLOYMENT.md](DEPLOYMENT.md): configuration, operations, backups, releases.

Running the production images exposed three problems the development setup could not, all fixed:
1. Angular's production build inlined critical CSS and loaded the stylesheet with an inline `onload` handler,
   which the strict CSP blocks — the full stylesheet would never have applied. Critical-CSS inlining is off; the
   smoke test now fails if the page contains inline scripts or handlers.
2. Requesting server-side encryption per object (`AES256`) made the S3-compatible store return encrypted bytes
   — every photo would have been broken. Encryption is now opt-in (`S3_SERVER_SIDE_ENCRYPTION`; AWS S3 and R2
   encrypt at rest anyway); the smoke test now checks the downloaded photo and thumbnail are valid images.
3. Presigned links must use an address the browser can reach (`S3_PUBLIC_ENDPOINT`), separate from the
   in-network endpoint the API uploads to.

**CI/CD** (`.github/workflows/ci.yml`) — checks (production-dependency audit, type checks, contracts, backend
and frontend tests, builds) → end-to-end suite (report and API log uploaded on failure) → Docker images built,
started as a full stack and smoke-tested → images published to GitHub Container Registry for `main` and `v*`
tags. The performance check runs on demand.

## Verification

| Check | Result |
|---|---|
| Backend (unit + integration, real MongoDB) | **248 passing** — new: GEDCOM writer, exports, account and family deletion, purge, removed-file restore, reports (3), route sweep and security checks (6), log redaction, kinship cache invalidation on renames |
| Frontend unit / contracts | 28 / 23 passing |
| End-to-end (Playwright, desktop + phone) | **15 passing** |
| Performance (20 000 people) | all operations within budget after the two fixes above |
| Container stack | both images built; full stack healthy; smoke test (11 checks) passing; app loaded in a browser through nginx with no CSP violations, thumbnails rendering |
| `npm audit` | 0 vulnerabilities |

## Not verified here

The GitHub Actions workflow could not be run from this environment; its YAML and the compose file were
validated, and every command it runs was run locally (Docker images built and the stack smoke-tested the same
way the workflow does).
