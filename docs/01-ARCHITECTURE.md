# 1. System Architecture

## 1.1 Requirements analysis — decisions that had to be made first

The brief is large. Before writing code, these are the decisions that shape everything else, with the choice made and why.

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | How is the genealogy stored? | As a **graph**: one document per person (`family_members`) and one document per edge (`relationships`). Siblings, grandparents, cousins, branches and generations are **derived**, never stored as edges. | Storing derived edges (e.g. "sibling") creates contradictions the moment a parent link changes. A person-per-document model keeps a 50 000-person family well under MongoDB's 16 MB document limit and lets every query be scoped by `familyId`. |
| D2 | How many edge types? | Two primary edge types: `parent_child` (directed) and `partnership` (undirected, stored with the two ids in sorted order). Each carries a **subtype** (biological / adoptive / step / foster / guardian / unknown; marriage / customary marriage / civil union / partnership …) and a **verification** state. | Genealogy is not a binary tree. A child can have more than two parental links (birth parents + adoptive parents + step-parent), and a person can have several partnerships. Two edge types with subtypes cover every case in the brief without special-casing. |
| D3 | What is a "generation"? | `generation(founder) = 1`; `generation(child) = generation(parent) + 1`, computed **only** over `parent_child` edges that are `verified` and whose subtype is in the family's *descent policy* (default: biological + adoptive). Never entered by hand. | Matches the brief's rules 1–3 and 8. Spouses who married in are not reachable over descent edges, so they are never assigned a descendant generation. Adoptive descent is included by default because most families regard an adopted child as part of the line; families can turn it off. |
| D4 | What happens when two paths give different generation numbers (e.g. cousin marriage across generations)? | The person is marked `conflict` with the **candidate numbers**, the conflict propagates to their descendants, and a review item is raised. An administrator can pin a resolution, which is audited. | Rule 7: never silently assign. See [04-GENERATION-ENGINE.md](04-GENERATION-ENGINE.md). |
| D5 | Where do generation numbers live? | Denormalised onto each person (`generation.number`, `generation.status`) and recomputed in the API process (in the background for large families) after any change to descent edges or the founder. Small families are recomputed inline in the same request. | Reading generation numbers is extremely frequent (tree, search, dashboard); writing them is rare. Recalculation is O(V + E) and takes milliseconds for thousands of people, but a family of 100 000 should not block an HTTP request. |
| D6 | Users vs. people | **Authentication accounts (`users`) are completely separate from genealogy profiles (`family_members`).** A `family_memberships` document links a user to a family with a role and, optionally, to the profile they have *claimed* after verification. | Most people in a family tree are deceased or never sign up. A user may belong to many families with different roles. Profiles are never merged or linked automatically by name. |
| D7 | Roles | Platform role on the user (`super_admin` or `user`). Family role on the membership (`family_admin`, `family_moderator`, `family_member`). "Guest" is the absence of a membership. Permissions are a static matrix in `@fh/contracts`, shared by backend and frontend. Moderators may be restricted to a set of branches. | One source of truth. The frontend uses the matrix only to hide controls; **the backend enforces every check**. |
| D8 | Can super administrators read private family data? | **No.** Platform administration endpoints expose account and family *registration* metadata and aggregate counts, never member records. A super admin who also needs to see a family must be invited to it like anyone else. | Explicit requirement in §3. |
| D9 | Session mechanism | Short-lived (15 min) **JWT access token** and a long-lived opaque **rotating refresh token**, both in `HttpOnly`, `Secure`, `SameSite=Strict` cookies. Refresh tokens are stored hashed (SHA-256) in `auth_sessions`, rotated on every use, with **reuse detection** (a replayed old token revokes the session). | Cookies are not readable by JavaScript, which removes the most common token-theft path (XSS). Rotation + reuse detection limits the damage from a stolen refresh token. |
| D10 | CSRF | Cookie-authenticated, so CSRF protection is required: **signed double-submit token** (`XSRF-TOKEN` cookie + `X-XSRF-TOKEN` header, HMAC-bound to a server secret) on every state-changing request, plus `SameSite=Strict`. | Angular's `HttpClient` implements the client side of this protocol natively. |
| D11 | Password hashing | Argon2id (memory 19 MiB, t=2, p=1 — the OWASP 2023 minimum), parameters configurable. Dummy verification for unknown e-mails to remove a user-enumeration timing signal. Per-account lockout after repeated failures plus per-IP rate limiting. | §2 and §16. |
| D12 | Collaboration model | Every change by a non-admin is a **contribution** (proposed patch) that is reviewed. Admin edits are applied directly but still produce an **audit log** entry with before/after values and are versioned so they can be restored. | §13. Keeps a single code path for "apply a change" (the contribution applier), used both by direct admin edits and by approvals. |
| D13 | Search | Normalised name tokens + phonetic keys (Double Metaphone) stored on each person, with compound indexes `{familyId, searchTokens}` and `{familyId, phoneticKeys}`. Optionally MongoDB Atlas Search later. | Supports partial names and spelling variations (Kwame / Kwamé / Quame) without requiring Atlas. |
| D14 | Tree rendering at scale | The API serves **windows** of the graph (a focus person ± N generations, or the children of a node) rather than the whole tree. The D3 layer lays out only the expanded subgraph and culls off-screen nodes. | §7 Performance. A 10 000-node SVG is unusable; nobody needs to see all of it at once. |
| D15 | Media storage | S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, GCS interop) accessed through a `StorageProvider` interface; uploads go through the API (size/type validated, magic-byte sniffed, re-encoded images) and downloads use short-lived signed URLs after an authorisation check. | No public buckets, so privacy settings cannot be bypassed by guessing a URL. |
| D16 | Uncertain dates | A `FuzzyDate` value object: `{ year?, month?, day?, qualifier: exact | about | before | after | between | estimated, endYear?, text? , sortKey }`. | Historical ancestors rarely have exact dates ("about 1890", "before 1920", "during the reign of …"). |
| D17 | Children's and living people's data | Privacy is resolved per field, server-side, by a **redaction policy** that depends on the viewer's relationship to the family, the person's living status and age. Living people are private by default; minors are additionally hidden from guests and their dates of birth are reduced to the year for ordinary members. | §5 and §16. |
| D18 | Monorepo layout | npm workspaces: `contracts` (shared TypeScript types + permission matrix), `backend`, `frontend`. | One definition of the API shapes and roles, compiled into both sides. |

### Open decisions (need product input; safe defaults chosen)

1. **E-mail verification at registration.** A verification link is sent at registration (Phase 6). Signing in does not require it, but accepting invitations and claiming a profile do, and the link only verifies the address it was sent to.
2. **Adoptive descent.** Default *included* in generation numbering; per-family setting.
3. **Data residency.** The storage and database providers are configurable; no region is assumed.
4. **Moderation of the super-admin role.** There is no UI to create super admins; they are created with a CLI script on the server (`npm run create-super-admin`), which is deliberate.

## 1.2 Runtime architecture

```
                ┌──────────────────────────────┐
  Browser ───── │ Angular 21 SPA (static files)│
   (HTTPS)      └──────────────┬───────────────┘
                               │ /api/v1  (cookies + X-XSRF-TOKEN)
                ┌──────────────▼───────────────┐
                │ Express API (Node 22, TS)     │──────► Object storage (S3-compatible)
                │  helmet · rate-limit · zod    │
                │  auth · RBAC · audit          │──────► SMTP (sent directly, with retries)
                │  generation recalculation     │
                └──────────────┬───────────────┘
                       ┌───────▼──────┐
                       │ MongoDB      │
                       │ (replica set)│
                       └──────────────┘
```

* **MongoDB must run as a replica set** (a single-node replica set is fine for development) because multi-document transactions are used, e.g. creating a person and their parent edge atomically.
* **No Redis and no worker.** One API process does everything: rate limits are counted in its memory, e-mail is sent straight to SMTP in the background (retried a few times), and generation numbers are recalculated in the request (or, for families over `GENERATION_INLINE_LIMIT`, in the background just after it). Run a single API instance.

## 1.3 Folder structure

```
family_tree/
├── package.json                 npm workspaces + root scripts
├── docker-compose.yml           MongoDB (replica set) + MailPit for local dev
├── docs/                        this documentation
├── contracts/                   @fh/contracts — shared by backend and frontend
│   └── src/
│       ├── api.ts               response envelope, pagination, error codes
│       ├── roles.ts             platform + family roles
│       ├── permissions.ts       permission matrix + can()
│       ├── auth.ts              auth DTOs
│       ├── users.ts             user DTOs
│       ├── families.ts          family DTOs + privacy settings
│       ├── members.ts           person DTOs, FuzzyDate, generation info
│       ├── relationships.ts     edge types, subtypes, kinship result
│       └── index.ts
├── backend/
│   ├── src/
│   │   ├── app.ts               express app factory (no listen; used by tests)
│   │   ├── server.ts            HTTP entry point
│   │   ├── config/env.ts        zod-validated environment
│   │   ├── core/                errors, response helpers, logger, crypto, pagination
│   │   ├── infra/               mongo, mailer, e-mail dispatcher, storage
│   │   ├── middleware/          request id, auth, csrf, rate limit, validate, authorize, errors
│   │   ├── modules/
│   │   │   ├── auth/            routes · controller · service · validators · session model · tokens
│   │   │   ├── users/           user model · repository · profile routes
│   │   │   ├── admin/           super-admin routes (accounts, platform stats)
│   │   │   ├── families/        family + membership models · access service · routes
│   │   │   ├── members/         person model (Phase 2 routes)
│   │   │   ├── relationships/   edge model (Phase 2 routes)
│   │   │   ├── branches/        branch model
│   │   │   ├── invitations/     invitation model
│   │   │   ├── contributions/   contribution model
│   │   │   ├── media/           media model
│   │   │   ├── events/          family event model
│   │   │   ├── generations/     generation snapshot model (Phase 3 engine)
│   │   │   └── audit/           audit log model + service
│   │   └── scripts/             create-super-admin
│   └── test/                    vitest unit + integration (mongodb-memory-server replica set)
└── frontend/
    └── src/app/
        ├── core/                auth store, http interceptors, guards, api client, nav config
        ├── shared/ui/           reusable presentational components (button, card, form field, alert…)
        ├── layout/              app shell: sidebar, top bar, mobile drawer
        └── features/
            ├── auth/            login, register, forgot/reset password
            ├── dashboard/
            ├── settings/
            ├── admin/           super-admin accounts page
            └── coming-soon/     honest placeholder for features of later phases
```

Each backend module follows the same layering: **routes** (HTTP wiring + middleware) → **controller** (request/response mapping only) → **service** (business rules, transactions, authorisation decisions that depend on data) → **repository/model** (Mongoose). Controllers never touch models directly.
