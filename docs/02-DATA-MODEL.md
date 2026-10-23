# 2. Data Model — MongoDB collections and the genealogy graph

The executable definitions are the Mongoose schemas under `backend/src/modules/*/*.model.ts`. This document explains them. Every collection except `users`, `auth_sessions` and `password_reset_tokens` carries a `familyId`, and **every query on those collections is scoped by `familyId`** (repositories take it as a required first argument).

Common conventions:

* `_id` is an `ObjectId`; references are `ObjectId`s named `<thing>Id`.
* `createdAt` / `updatedAt` via Mongoose timestamps.
* Soft deletion: `deletedAt: Date | null`, `deletedBy: ObjectId | null`. Partial indexes use `{ deletedAt: null }` so deleted records do not collide with live ones on unique keys.
* Optimistic concurrency (`version` key, `optimisticConcurrency: true`) on records people edit concurrently: families, members, relationships, contributions.

## 2.1 The genealogy graph

```
           partnership (marriage, current)
   Kofi ◄──────────────────────────────► Akosua          (Akosua married in: no generation)
    │  \                                    /
    │   parent_child (biological, verified)
    ▼                                     ▼
  Kwame (G2)                            Ama (G2)
    │
    ├── parent_child (biological)  ──► Yaw (G3)
    └── parent_child (adoptive)    ──► Esi (G3, adoptive descent counted by policy)
```

* **Vertices** — `family_members` documents (people). A person belongs to exactly one family tree. (The same human in two families' trees is two records; linking across families is out of scope and must never be automatic.)
* **Edges** — `relationships` documents:
  * `parent_child`: `personA` = parent, `personB` = child. Directed.
  * `partnership`: `personA` < `personB` (ids sorted), undirected.
* **Derived** (never stored): siblings (share ≥ 1 parent; full if they share 2 biological parents, half if 1), grandparents, cousins, in-laws, step-relations, branches' membership, generation numbers (stored as a cache only, recomputed by the engine).

Graph traversals use MongoDB `$graphLookup` for bounded queries (ancestors of X, descendants of X up to depth N) and an in-memory adjacency list for whole-family computations (generation engine), which is loaded with a covered index scan `{familyId, type, deletedAt}` projecting only `personA, personB, subtype, verification`.

### Integrity rules (enforced in the relationship service, inside a transaction)

1. Both endpoints exist, are not deleted, and belong to the same family.
2. No self-edges.
3. No duplicate edges — unique partial index on `{familyId, type, personA, personB}`.
4. **No cycles** — before inserting `parent → child`, the service checks (with `$graphLookup` upward from the parent) that the child is not already an ancestor of the parent.
5. At most **two biological parents** per child. Other parental subtypes are unbounded.
6. A person cannot be both parent and partner of the same person.
7. Removing an edge is a soft delete, audited, and triggers generation recalculation if it was a descent edge.

## 2.2 Collections

### `users` — authentication accounts
| Field | Type | Notes |
|---|---|---|
| email | string | lower-cased, **unique** |
| passwordHash | string \| null | Argon2id encoded hash; `select: false`; null for accounts made with Google until they set a password |
| displayName | string | |
| platformRole | `'super_admin' \| 'user'` | |
| status | `'active' \| 'suspended' \| 'deleted'` | |
| emailVerifiedAt | Date \| null | |
| passwordChangedAt | Date | |
| failedLoginCount, lockedUntil | number, Date \| null | account lockout |
| lastLoginAt | Date \| null | |
| preferences | `{ locale, theme: 'system'\|'light'\|'dark', defaultFamilyId, tourSeen }` | |

| mfa | `{ totpSecret, enabledAt, lastUsedStep, recoveryCodes: [{ hash, usedAt }], pendingSecret, pendingCreatedAt }` | two-step sign-in; secrets AES-256-GCM encrypted (`MFA_ENCRYPTION_KEY`) and `select: false`; recovery codes stored as keyed hashes; `lastUsedStep` stops a code being used twice |
| google | `{ sub, email, linkedAt }` | the Google account linked for signing in |

Indexes: `{email: 1}` unique; `{platformRole: 1, status: 1}`; `{'google.sub': 1}` unique where set.

### `mfa_challenges` — the step between the password (or Google) and the code
`userId`, `tokenHash` (SHA-256 of the single-use challenge), `method: 'password' | 'google'`, `attempts` (at most 5), `usedAt`, `expiresAt` (5 minutes; TTL index).

### `auth_sessions` — refresh-token sessions
`userId`, `tokenHash` (SHA-256 of current refresh token, unique), `previousTokens: [{hash, rotatedAt}]` (last 10, for reuse detection), `expiresAt` (**TTL index**), `revokedAt`, `revokedReason`, `userAgent`, `ip`, `lastUsedAt`.

### `password_reset_tokens`
`userId`, `tokenHash` (unique), `expiresAt` (TTL), `usedAt`, `requestedIp`.

### `families`
| Field | Type | Notes |
|---|---|---|
| name | string | e.g. "Mensah Family" |
| slug | string | unique, URL-safe |
| description, history | string | |
| emblemMediaId | ObjectId \| null | → `family_media` |
| foundingMemberId | ObjectId \| null | → `family_members` (Generation 1) |
| origin | `{ hometown, region, country }` | |
| privacy | `{ visibility: 'private' \| 'unlisted' \| 'public', showLivingToMembers: boolean, allowMemberUploads: boolean, requireApprovalForMemberEdits: boolean }` | defaults: private / true / true / true |
| generationPolicy | `{ countAdoptive: boolean }` | default true |
| status | `'active' \| 'suspended' \| 'archived'` | platform-managed |
| stats | `{ memberCount, generationCount, branchCount, livingCount, deceasedCount, recalculatedAt }` | cache written by jobs |
| createdBy | ObjectId → users | |

Indexes: `{slug: 1}` unique; `{'privacy.visibility': 1, status: 1}`.

### `family_memberships` — user ↔ family (+ claimed profile)
`familyId`, `userId`, `role: 'family_admin' | 'family_moderator' | 'family_member'`, `moderatedBranchIds: ObjectId[]` (empty = all branches, only meaningful for moderators), `memberProfileId` (claimed person, set only after verification), `status: 'active' | 'removed'`, `invitedBy`, `joinedAt`.

Indexes: `{familyId, userId}` **unique**; `{userId, status}`; `{familyId, role}`.

### `family_members` — people
| Group | Fields |
|---|---|
| Names | `firstName`, `middleNames`, `surname`, `maidenName`, `previousNames[]`, `preferredName`, `title` |
| Identity | `gender?: 'female' \| 'male' \| 'non_binary' \| 'other' \| 'undisclosed'` (optional, voluntary) |
| Life | `vitalStatus: 'living' \| 'deceased' \| 'unknown'`, `birthDate: FuzzyDate`, `birthPlace`, `deathDate: FuzzyDate`, `deathPlace`, `nationality`, `hometown` |
| Story | `biography`, `education[]`, `occupations[]`, `achievements[]`, `stories[]`, `sources[]` (`{title, citation, url, mediaId}`) |
| Media | `profilePhotoMediaId` |
| Private | `contact: { email, phone, address }` — `select: false`, visible only to admins and the person's own claimed account |
| Privacy | `privacy: { level: 'family' \| 'public' \| 'restricted', hideDates: boolean }`; living people default `family` and are never `public` unless explicitly set |
| Generation (cache) | `generation: { number: number \| null, status: 'founder' \| 'computed' \| 'conflict' \| 'married_in' \| 'unconnected' \| 'unverified_path' \| 'pending', candidates: number[], override: { number, reason, by, at } \| null, computedAt }` |
| Search | `searchTokens[]` (normalised, diacritics removed, all name parts + prefixes), `phoneticKeys[]` |
| Lifecycle | `createdBy`, `updatedBy`, `deletedAt`, `deletedBy`, `version` |

`FuzzyDate = { year?, month?, day?, qualifier: 'exact'|'about'|'before'|'after'|'between'|'estimated', endYear?, text?, sortKey: number|null }`, where `sortKey = year*10000 + month*100 + day` with unknown parts as 0, used for ordering and range queries only.

Indexes: `{familyId, deletedAt, 'generation.number'}`; `{familyId, searchTokens}`; `{familyId, phoneticKeys}`; `{familyId, surname, firstName}`; `{familyId, 'birthDate.year'}`; `{familyId, hometown}`; `{familyId, importBatchId}` (partial).

Phase 9 added `importBatchId` (the GEDCOM import that created the person, so it can be undone as a whole) and `mergedInto` (set on a person merged into another; such people are removed and only come back by undoing the merge).

### `relationships` — edges
`familyId`, `type: 'parent_child' | 'partnership'`, `personA`, `personB`, `subtype` (`parent_child`: biological / adoptive / step / foster / guardian / unknown; `partnership`: marriage / customary_marriage / civil_union / partnership / engagement / unknown), `status` (partnership only: current / divorced / separated / widowed / annulled / unknown), `startDate`, `endDate` (FuzzyDate), `verification: 'verified' | 'unverified' | 'disputed'`, `sources[]`, `notes`, `createdBy`, `deletedAt`, `version`.

Indexes: `{familyId, type, personA, personB}` **unique, partial on `deletedAt: null`**; `{familyId, personB, type}` (parents of X); `{familyId, personA, type}` (children / partners of X); `{familyId, importBatchId}` (partial). `importBatchId` marks links added by a GEDCOM import.

### `family_branches`
`familyId`, `name`, `foundingMemberId` (the branch is "all descendants of this person"), `description`, `history`, `administrators: ObjectId[]` (users), `stats: { descendantCount, generationSpan, livingCount, recalculatedAt }`. Membership of a branch is **derived** by descendant traversal — people are never copied into branches, and a person can belong to several branches.
Indexes: `{familyId, foundingMemberId}` unique (partial, live); `{familyId, name}`.

### `family_invitations`
`familyId`, `email` (lower-cased), `tokenHash` (unique), `role`, `suggestedProfileId` (a person they may claim — claim still requires admin verification), `invitedBy`, `expiresAt` (TTL after expiry + 30 days for audit), `status: 'pending' | 'accepted' | 'revoked' | 'expired'`, `acceptedBy`, `acceptedAt`.
Indexes: `{tokenHash}` unique; `{familyId, email, status}`.

### `family_contributions` — proposed changes
`familyId`, `kind: 'member.create' | 'member.update' | 'member.delete' | 'relationship.create' | 'relationship.update' | 'relationship.delete' | 'media.attach' | 'story.create' | 'claim.profile'`, `targetType`, `targetId`, `branchIds[]` (for moderator scoping), `payload` (the proposed values), `previousValues` (snapshot at proposal time, for conflict detection), `status: 'pending' | 'needs_clarification' | 'approved' | 'rejected' | 'withdrawn'`, `proposedBy`, `reviewedBy`, `reviewedAt`, `reviewNote`, `discussion: [{by, message, at}]`, `appliedChangeId` (→ audit log).
Indexes: `{familyId, status, createdAt: -1}`; `{familyId, proposedBy}`; `{familyId, targetType, targetId}`.

### `family_media`
`familyId`, `kind: 'photo' | 'document' | 'audio' | 'video'`, `title`, `description`, `storageKey`, `mimeType`, `byteSize`, `sha256`, `width?`, `height?`, `durationSec?`, `memberIds[]`, `eventId?`, `date: FuzzyDate`, `privacy: 'family' | 'admins' | 'public'`, `provenance: { source, citation, originalHolder }`, `uploadedBy`, `status: 'processing' | 'pending_approval' | 'published' | 'rejected'`, `thumbKey` (WebP preview of photos), `originalName`, `searchText`, `deletedAt`, `version`. Storage keys are `families/<familyId>/media/<mediaId>/original.<ext>` and `…/thumb.webp`.
Indexes: `{familyId, memberIds}`; `{familyId, kind, createdAt: -1}`; `{familyId, status}`.

### `family_stories`
`familyId`, `kind: 'story' | 'oral_history' | 'tradition' | 'memory'`, `title`, `body` (plain text; the transcript for oral histories), `narrator`, `date: FuzzyDate`, `place`, `memberIds[]`, `eventId?`, `mediaIds[]`, `recordingMediaId?` (audio/video), `sources[]`, `privacy`, `status: 'pending_approval' | 'published' | 'rejected'`, `searchText`, `createdBy`, `updatedBy`, `deletedAt`, `version`.
Indexes: `{familyId, deletedAt, createdAt: -1}`; `{familyId, memberIds}`; `{familyId, 'date.sortKey'}`; `{familyId, status}`. (Phase 7 replaced the unused embedded `family_members.stories[]`.)

### `family_events`
`familyId`, `kind: 'birth' | 'death' | 'marriage' | 'reunion' | 'migration' | 'tradition' | 'historical' | 'other'`, `title`, `description`, `date: FuzzyDate`, `place`, `memberIds[]`, `mediaIds[]`, `privacy`, `createdBy`, `deletedAt`.
Indexes: `{familyId, 'date.sortKey'}`; `{familyId, memberIds}`.

### `audit_logs` — append-only
`familyId` (null for platform-level actions), `actorId`, `actorRole`, `action` (e.g. `member.update`, `relationship.delete`, `admin.user.suspend`), `targetType`, `targetId`, `before`, `after` (redacted of secrets), `contributionId?`, `requestId`, `ip`, `at`.
Indexes: `{familyId, at: -1}`; `{familyId, targetType, targetId, at: -1}`; `{actorId, at: -1}`. The application never updates or deletes these documents; "restore previous version" writes a new change whose `after` equals an earlier `before`.

### `family_funds`
`familyId`, `name`, `purpose`, `kind: 'dues' | 'ceremony' | 'project' | 'welfare' | 'other'`, `currency` (ISO 4217, default GHS), `target` (minor units), `dues: { amount, period: 'monthly' | 'yearly' | 'once' } | null`, `payerIds[]` (people expected to pay dues), `status: 'open' | 'closed'`, `visibility: 'admins' | 'totals' | 'members'`, `ceremonyId` (the event it collects for), `createdBy`, `deletedAt`, `version`. Index `{familyId, deletedAt, createdAt: -1}`.

### `fund_contributions`
`familyId`, `fundId`, `memberId` (someone in the tree) or `contributorName`, `amount` (integer, minor units — pesewas for GHS), `date` (YYYY-MM-DD), `method: 'cash' | 'mobile_money' | 'bank' | 'cheque' | 'other'`, `reference`, `note`, `recordedBy`, `deletedAt`. Indexes `{familyId, fundId, deletedAt, date: -1}`, `{familyId, memberId}`.

Phase 11 also added to `family_members`: `maternalLine`, `paternalLine`, `totem` (recorded values; empty means inherited — lines are worked out on reading, see `modules/lineage/lineage-engine.ts`, and cached per family revision); to `families`: `lineage: { maternal: { enabled, label }, paternal: { enabled, label }, totemFollows, throughAdoption }`; to `family_memberships`: `treasurer`; to `family_events`: ceremony kinds (`naming`, `engagement`, `wedding`, `funeral`, `one_week`, `memorial`, `thanksgiving`), `programme: [{ time, title, detail, lead }]`, `roles: [{ role, memberId, name }]`, `fundId`.

### `family_places`
`familyId`, `name`, `region`, `country`, `latitude`, `longitude` (both or neither), `aliases[]` (other names and spellings), `notes`, `keys[]` (normalised name and aliases, without accents or punctuation — what free-text places are matched against), `createdBy`, `deletedAt`, `version`. Indexes `{familyId, deletedAt, name}`, `{familyId, keys}`. People's `birthPlace`, `deathPlace` and `hometown`, and events' `place`, stay free text: a place matches when the whole text or its part before the first comma equals one of its keys. Counts and moves are worked out on reading, per viewer.

Phase 12 also added to `family_media`: `tags: [{ memberId, box: { x, y, w, h } }]` (fractions of the photo; one box per person; tagged people are also in `memberIds`; merges move tags and undo puts them back) and `transcript: { status: 'none' | 'pending' | 'done' | 'failed', text, language, source: 'typed' | 'automatic', translation: { text, language } | null, error, updatedAt }` (recordings and videos; the text and translation are part of the media search text). Index `{familyId, 'tags.memberId'}`. `member_merges` gained `photoTags: [{ mediaId, change: 'moved' | 'removed', box }]`.

### `family_books` — printable books
`familyId`, `requestedBy`, `title`, `options` (BookOptions: scope `family | branch | person`, `branchId`, `personId`, `generations`, `include`, `living: 'names' | 'full'`, `paper`, `locale`, translated `labels`), `status: 'queued' | 'running' | 'done' | 'failed'`, `progress`, `storageKey` (`families/<id>/books/<bookId>.pdf`), `sizeBytes`, `pages`, `people`, `error`, `startedAt`, `finishedAt`. Index `{familyId, requestedBy, createdAt: -1}`. Ten kept per person and family; older ones and their files are removed.

### `push_subscriptions` — devices that receive notifications
`userId`, `endpoint` (unique; a URL at a browser push service — Google, Mozilla, Apple or Microsoft only), `keys: { p256dh, auth }`, `userAgent`, `lastSentAt`. At most 10 per account; removed when the push service says the device unsubscribed, and when the account is deleted. Index `{userId}`.

### `notification_deliveries`
`userId`, `kind: 'digest' | 'push'`, `key` (ISO week such as `2026-W43` for the weekly e-mail, local day `2026-10-19` for the morning notification), `sent`, `createdAt` (TTL 120 days). The unique index `{userId, kind, key}` makes the hourly reminder run idempotent across runs and workers.

Phase 10 also added `users.notifications: { weeklyDigest, push, kinds: { birthday, remembrance, birth_remembrance, anniversary, event }, timezone }` (unset = defaults: weekly e-mail on, phone notifications off, all kinds but birthdays of those who have passed, UTC).

### `family_imports` — GEDCOM imports
`familyId`, `fileName`, `sha256`, `source` (program and GEDCOM version from the file's header), `status: 'active' | 'undone'`, `counts: { created, matched, filled, parentLinks, partnerships, skipped }`, `warningCount`, `filled: [{ memberId, before, after }]` (details filled in on people already in the family, put back on undo when unchanged since), `createdBy`, `undoneAt`, `undoneBy`. Index `{familyId, createdAt: -1}`.

### `duplicate_dismissals`
`familyId`, `a`, `b` (the two people, smaller id first), `createdBy`: pairs an administrator said are different people, never suggested again. Index `{familyId, a, b}` unique.

### `member_merges`
`familyId`, `keepId`, `otherId`, `otherName`, `status: 'active' | 'undone'`, `keepBefore` (the kept person's stored details before the merge), `keepVersionAfter`, `links: [{ edgeId, change: 'moved' | 'removed', personA, personB }]` (each link's ends before the merge), `replaced` / `pulled: { media, stories, events }` (archive items whose people were rewritten), `membershipId`, `founderMoved`, `branchIds`, `invitationIds`, `contributionIds`, `removedAt`, `createdBy`, `undoneAt`, `undoneBy`. Undo is allowed while the kept person is unchanged since the merge. Index `{familyId, createdAt: -1}`.

### `generation_snapshots`
`familyId`, `founderId`, `computedAt`, `durationMs`, `totals: { members, generations, conflicts, unconnected, marriedIn }`, `byGeneration: [{ number, total, living, deceased, unknown, earliestBirthYear, latestBirthYear }]`. One document per recalculation; the dashboard reads the latest. Index `{familyId, computedAt: -1}`; old snapshots kept for trend charts.

## 2.3 Transactions

Used wherever more than one document must change together, e.g.:

* add person + parent edge + audit entry;
* approve contribution → apply change → write audit log → mark contribution approved;
* change founding ancestor → update family → enqueue recalculation (the job is enqueued only after commit).
