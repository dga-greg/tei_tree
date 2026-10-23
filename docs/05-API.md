# 5. REST API Specification

Base path: `/api/v1`. JSON only (except uploads: `multipart/form-data`). Status column: **✅ implemented**, otherwise the phase that delivers it.

## 5.1 Conventions

**Success**
```json
{ "data": { ... } }
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 25, "total": 312, "totalPages": 13 } }
```
**Error**
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed", "details": [{ "path": "email", "message": "Invalid email" }], "requestId": "9f1c…" } }
```
Error codes (`contracts/src/api.ts`): `VALIDATION_FAILED` 400 · `UNAUTHENTICATED` 401 · `INVALID_CREDENTIALS` 401 · `SESSION_EXPIRED` 401 · `CSRF_INVALID` 403 · `FORBIDDEN` 403 · `ACCOUNT_SUSPENDED` 403 · `NOT_FOUND` 404 · `CONFLICT` 409 · `EMAIL_TAKEN` 409 · `VERSION_CONFLICT` 409 · `ACCOUNT_LOCKED` 423 · `RATE_LIMITED` 429 · `INTERNAL` 500.

* **Pagination:** `?page=1&pageSize=25` (max 100). Lists return `meta`.
* **Filtering/sorting:** explicit, whitelisted query parameters per endpoint (`?generation=3&branchId=…&sort=surname`).
* **Concurrency:** updatable resources return `version`; `PATCH` bodies include it and get `409 VERSION_CONFLICT` if stale.
* **Auth:** cookies `fh_access` (JWT, 15 min, path `/api`) and `fh_refresh` (opaque, 30 days, path `/api/v1/auth`). All `POST/PUT/PATCH/DELETE` require header `X-XSRF-TOKEN` equal to cookie `XSRF-TOKEN` (obtain with `GET /auth/csrf`).
* **Request id:** every response has `X-Request-Id`.
* **Rate limits:** global 300 req/min/IP; auth endpoints 10 req/15 min/IP for login, register, forgot/reset password.

## 5.2 Authentication

| Method & path | Auth | Body → Response | Status |
|---|---|---|---|
| `GET /auth/csrf` | — | → `{ token }` and sets `XSRF-TOKEN` cookie | ✅ |
| `POST /auth/register` | — | `{ email, password, displayName }` → `201 { user }` + session cookies | ✅ |
| `POST /auth/login` | — | `{ email, password }` → `{ user }` + cookies, or (two-step sign-in on) `{ mfaRequired: true, challenge, expiresAt }` and no cookies | ✅ |
| `POST /auth/login/mfa` | — | `{ challenge, code }` or `{ challenge, recoveryCode }` → `{ user }` + cookies; wrong codes `401 MFA_INVALID` (count towards the account lock; 5 per challenge); used or expired challenge `409` | ✅ |
| `GET /auth/mfa` | ✅ | → `{ enabled, enabledAt, recoveryCodesLeft, required }` | ✅ |
| `POST /auth/mfa/totp/setup` | ✅ | `{ password }` → `{ secret, otpauthUri, qrSvg }` (pending until confirmed) | ✅ |
| `POST /auth/mfa/totp/enable` | ✅ | `{ code }` → `{ codes }` (10 recovery codes, shown once); signs out other sessions | ✅ |
| `POST /auth/mfa/disable` · `POST /auth/mfa/recovery-codes` | ✅ | `{ password, code \| recoveryCode }` → `204` · `{ codes }` | ✅ |
| `GET /auth/google/start?mode=login\|link&next=/path` | — (link: ✅) | navigation: sets the signed `fh_google` flow cookie (SameSite=Lax, 10 min) and redirects to Google with state, nonce and PKCE | ✅ |
| `GET /auth/google/callback` | — | navigation: checks state, exchanges the code, verifies the ID token; signs in (or redirects to `/auth/two-step#challenge=…`), creates an account for a new address, links when both sides vouch for the address, else redirects to `/auth/login?google=<reason>` | ✅ |
| `DELETE /auth/google` | ✅ | → `204`; refused (409) for accounts without a password | ✅ |
| `POST /auth/logout` | cookie | → `204`, revokes session, clears cookies | ✅ |
| `POST /auth/refresh` | refresh cookie | → `{ user }`, rotates refresh token | ✅ |
| `POST /auth/forgot-password` | — | `{ email }` → `202` always (no account enumeration) | ✅ |
| `POST /auth/reset-password` | — | `{ token, password }` → `204`, revokes all sessions | ✅ |
| `GET /auth/me` | ✅ | → `{ user }` | ✅ |
| `POST /auth/activity` — the app reports that the person is using it (at most every few minutes). Sessions without "Keep me signed in" (`remember` on login, `remember=1` on Google start) end after `IDLE_TIMEOUT_MINUTES` without activity: refresh and activity then answer 401; `user.session.idleTimeoutMinutes` tells the app the limit | ✅ |
| `PATCH /auth/me` | ✅ | `{ displayName?, preferences? }` → `{ user }` | ✅ |
| `POST /auth/change-password` | ✅ | `{ currentPassword, newPassword }` → `204`, revokes other sessions; accounts made with Google set a first password without `currentPassword` (within 15 minutes of signing in) | ✅ |
| `GET /auth/sessions` / `DELETE /auth/sessions/:id` | ✅ | list / revoke own sessions | ✅ |
| `POST /auth/verify-email` | — | `{ token }` — the address must still match the account → `{ user }` | ✅ |
| `POST /auth/resend-verification` | ✅ | → `202`, new 24-hour link (rate limited) | ✅ |

## 5.3 Platform administration (super admin)

| Method & path | Permission | Status |
|---|---|---|
| `GET /admin/stats` → `{ users: {total, active, suspended}, families: {total, active} }` | `platform.stats` | ✅ |
| `GET /admin/users?q=&status=&page=` | `platform.users.view` | ✅ |
| `PATCH /admin/users/:userId` `{ status?, platformRole? }` (cannot change self) | `platform.users.manage` | ✅ |
| `GET /admin/families?q=&status=` (registration metadata only) | `platform.families.view` | ✅ |
| `PATCH /admin/families/:familyId` `{ status }` | `platform.families.manage` | ✅ |
| `GET /admin/reports?status=open\|resolved\|dismissed` · `PATCH /admin/reports/:id` `{ status, resolution, notifyFamilyAdmins?, suspendFamily? }` — shows what was reported (as named then), never family records | `platform.reports.manage` | ✅ |
| `POST /reports` `{ familyId, targetType: family\|member\|media\|story\|event, targetId?, reason, details }` — anyone signed in, about something they can see; one open report per item | auth | ✅ |

## 5.4 Families

| Method & path | Permission | Status |
|---|---|---|
| `GET /families` — families the caller belongs to, with role | auth | ✅ |
| `GET /families/:familyId` | `family.view` (guests: public families, public fields) | ✅ |
| `POST /families` `{ name, description, history, origin, privacy, generationPolicy, founder? }` — caller becomes `family_admin`; the optional founder is created as Generation 1 in the same transaction | `family.create` | ✅ |
| `PATCH /families/:familyId` `{ version, … }` | `family.update` / `family.manage_privacy` | ✅ |
| `PUT /families/:familyId/founder` `{ memberId, reason? }` — sets Generation 1 and renumbers everyone | `family.set_founder` | ✅ |
| `GET /families/:familyId/memberships` · `PATCH …/memberships/:id` `{ role?, moderatedBranchIds? }` · `DELETE …/memberships/:id` · `DELETE …/memberships/:id/profile` (unlink claimed profile) — the last administrator cannot be demoted or removed | `membership.manage` | ✅ |
| `POST /families/:familyId/leave` | member | ✅ |

## 5.5 Members (people)

| Method & path | Permission | Status |
|---|---|---|
| `POST /families/:familyId/members` `{ person, links?: { parents?, children?, partners? } }` — person and links in one transaction | `member.create` | ✅ |
| `GET /families/:familyId/members?q=&generation=&vitalStatus=&hometown=&birthYear=&sort=&page=` (branch filter: Phase 4) | `member.view` | ✅ |
| `GET /families/:familyId/members/search?q=` (partial, phonetic; top 10) | `member.view` | ✅ |
| `GET /families/:familyId/members/:memberId` (redacted per viewer; includes parents, children, partners and derived siblings) | `member.view` | ✅ |
| `PATCH /families/:familyId/members/:memberId` `{ version, … }` | `member.update` | ✅ |
| `DELETE /families/:familyId/members/:memberId` — soft delete with relationships (admins) | `member.delete` | ✅ |
| Removal proposals (non-admins): `POST …/contributions` `{ kind: 'member.delete', targetId, payload: { reason } }` | `contribution.submit` | ✅ |
| Own claimed profile: `PATCH …/members/:memberId` with personal fields only (preferred name, biography, work, education, achievements, contact, nationality, hometown, privacy) | own | ✅ |
| History of one person: `GET /families/:familyId/audit?targetId=` · undo: `POST …/audit/:auditId/restore` (edits, removals of people and links) | `audit.view` / `record.restore` | ✅ |
| `GET /families/:familyId/trash/members` · `POST …/trash/members/:memberId/restore` — brings back the person and the links removed with them, unless they now conflict | `record.restore` | ✅ |

## 5.6 Relationships

| Method & path | Permission | Status |
|---|---|---|
| `POST /families/:familyId/relationships` `{ type, personA, personB, subtype, status?, startDate?, endDate?, verification, notes?, sources? }` | `relationship.manage` | ✅ |
| `GET` / `PATCH /families/:familyId/relationships/:id` `{ version, … }` | `relationship.manage` | ✅ |
| `DELETE /families/:familyId/relationships/:id` (soft delete) | `relationship.manage` | ✅ |
| `GET /families/:familyId/relationships/between?a=&b=` → kind, term and reciprocal, summary, explanation, cousin degree/removal/half, closest common ancestors, the path with labelled steps, confidence, adoption flag (members only) | `member.view` | ✅ |

## 5.7 Generations

| Method & path | Permission | Status |
|---|---|---|
| `GET /families/:familyId/generations` → founder, totals, per-generation counts, recalculation state | member | ✅ |
| People of one generation: `GET /families/:familyId/members?generation=n` (also `generationStatus=conflict\|married_in\|…`) | `member.view` | ✅ |
| `GET /families/:familyId/generations/stats` → one point per day for the past year | member | ✅ |
| `POST /families/:familyId/generations/recalculate` → `202` with the summary | `generation.recalculate` | ✅ |
| `PUT` / `DELETE /families/:familyId/members/:memberId/generation-override` `{ number, reason }` — only for conflicts, only to a candidate | `generation.recalculate` | ✅ |
| `GET /families/:familyId/generations/conflicts` (open and resolved) | member | ✅ |

## 5.8 Family tree (graph windows)

All return `{ rootId, nodes: TreeNode[], edges: TreeEdge[], truncated }` — never the whole family. `depth` = generations below the starting person (1–6, default 3); windows stop at 1 500 people. Every window includes the partners of the people in it and every edge between them; `TreeNode.childCount` / `parentCount` tell the client what can still be expanded. Guests of public families see only public deceased people, and counts only include people they may see.

| Method & path | Status |
|---|---|
| `GET /families/:familyId/tree/root?depth=` — founding ancestor and descendants | ✅ |
| `GET /families/:familyId/tree/nodes/:memberId/children` — expand one node | ✅ |
| `GET /families/:familyId/tree/nodes/:memberId/descendants?depth=` | ✅ |
| `GET /families/:familyId/tree/nodes/:memberId/ancestors?depth=` — used by search-and-focus | ✅ |
| `GET /families/:familyId/tree/branches/:branchId?depth=` | ✅ |
| Relationship path in the tree: the client opens `…/tree/nodes/:id/ancestors` for each person on the path returned by `relationships/between` and highlights it (`/tree?path=a,b`) | ✅ |

## 5.9 Branches, collaboration, invitations, media, history

| Method & path | Status |
|---|---|
| `GET/POST /families/:familyId/branches`, `POST …/branches/from-founder-children`, `GET/PATCH/DELETE …/branches/:id` (stats included; members of a branch: `GET …/members?branchId=`) | ✅ |
| `POST /families/:familyId/contributions` `{ kind, targetId?, payload, note? }` (kinds: member.create/update/delete, relationship.create/update/delete, claim.profile) · `GET …/contributions?status=&mine=` (reviewers: all in scope; others: their own) · `GET …/contributions/:id` (with field-by-field changes and a stale flag) | ✅ |
| `POST …/contributions/:id/approve` `{ note?, force? }` · `…/reject` `{ note }` · `…/request-clarification` `{ message }` · `…/respond` `{ message, payload? }` · `…/withdraw` — approval applies the change through the normal services (same checks, audit entry linked to the suggestion); nobody reviews their own | ✅ |
| `GET /families/:familyId/audit?targetType=&targetId=&action=&page=` — with readable changes and whether each can be undone | ✅ |
| `POST /families/:familyId/invitations` `{ email, role, message?, suggestedProfileId? }` · `GET …` · `POST …/:id/resend` · `DELETE …/:id` | ✅ |
| `POST /invitations/preview` `{ token }` (public) · `POST /invitations/accept` `{ token }` — token in the body, never the URL path; the signed-in address must match, and the link (which reached that inbox) confirms it | ✅ |
| `GET /invitations/mine` — pending invitations to the signed-in person's confirmed address · `POST /invitations/:id/accept` — joins one of them without the link | ✅ |
| `POST /families/:familyId/claims` `{ memberId, evidence? }` — verified address, one open claim at a time, reviewed like any suggestion | ✅ |
| `POST /families/:familyId/media` — multipart: metadata fields (`title`, `description`, `date`*, `memberIds`*, `eventId`, `privacy`, `provenance`*, `note`, `profileOf`; *JSON) then one `file` part. Typed by content; photos re-encoded without metadata plus a WebP thumbnail; duplicates (same SHA-256) → 409; too large → 413; unaccepted type → 415. Members' uploads → `pending_approval` + a `media.attach` suggestion | ✅ |
| `GET …/media?kind=&memberId=&eventId=&q=&status=&page=` · `GET …/media/:id` · `PATCH …/media/:id` `{ version, … }` · `DELETE …/media/:id` (soft) | ✅ |
| `GET …/media/:id/content[?variant=thumb][&download=1]` → `302` to a signed link (local: `/api/v1/files/:token`, HMAC-signed, supports `Range`; S3: presigned URL) | ✅ |
| Profile photo: `PATCH …/members/:id` `{ version, profilePhotoMediaId }` (a published photo; allowed on one's own claimed profile) | ✅ |
| Profile photo in one step: upload with `profileOf: memberId` — the photo is tagged with the person and becomes their profile photo (editors, or one's own claimed profile). For reviewed uploads it is set when a moderator approves the `media.attach` suggestion. Only pictures, not restricted to administrators; the same picture again reuses the archived copy | ✅ |
| `GET/POST /families/:familyId/stories` · `GET/PATCH/DELETE …/stories/:id` — kinds story / oral_history / tradition / memory, with narrator, date, place, people, attached files and a recording. Members' stories → `pending_approval` + a `story.create` suggestion | ✅ |
| `GET/POST /families/:familyId/events` · `GET/PATCH/DELETE …/events/:id` (`event.manage`) | ✅ |
| `GET /families/:familyId/timeline?memberId=&from=&to=&include=events,stories,records` — recorded events, dated stories, and births/deaths/marriages derived from the record under profile privacy (≤ 2 000 lines, `meta.truncated`) | ✅ |
| `GET /families/:familyId/dashboard` — totals, per-generation counts, recently added, monthly growth (plus branch count and the suggestions waiting on the viewer) | ✅ |
| `GET /families/:familyId/export?format=json\|gedcom&living=include\|private` — attachment; GEDCOM 5.5.1 or a complete JSON backup (no accounts, no files) | `family.export` | ✅ |
| `POST /families/:familyId/deletion` `{ name, password }` → `202 { deletionScheduledFor }` (family closes at once) · `DELETE /families/:familyId/deletion` (restore, administrators) · `GET /families/scheduled-deletions` | `family.delete` | ✅ |
| `GET /families/:familyId/trash/media` · `POST …/trash/media/:id/restore` — removed files, until the retention period ends | `record.restore` | ✅ |
| `POST /families/:familyId/import/gedcom/preview` — multipart `file` (.ged, ≤ 30 MB, ≤ 20 000 people): counts, the program that wrote it, the first 100 people, likely matches with people already in the family (score, reasons), warnings | `family.import` | ✅ |
| `POST /families/:familyId/import/gedcom` — multipart `decisions` (JSON `{ same: { fileRef: memberId }, fillBlanks, verifyLinks }`) then `file`: imports in one transaction, applying the integrity rules (extra birth parents → "unknown", links that would make someone their own ancestor skipped) → `201` import summary · `GET …/imports` · `POST …/imports/:id/undo` | `family.import` | ✅ |
| `GET /families/:familyId/duplicates?limit=` — likely duplicate pairs with score and reasons · `POST …/duplicates/dismiss` `{ a, b }` | `member.merge` | ✅ |
| `POST /families/:familyId/members/:keepId/merge` `{ otherId, choices: { field: 'keep'\|'other' }, keepVersion, otherVersion }` — moves links, archive tags, a claimed account, founder, branches, invitations and open suggestions to the kept person; refused (409) if it would break a family rule · `GET …/merges` · `POST …/merges/:id/undo` | `member.merge` | ✅ |
| `GET /families/:familyId/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 366 days) — birthdays, remembrance days, birthdays of those who have passed, wedding anniversaries and dated events, each with a ready-to-show title, the people and the years; built from each viewer's view of the profiles | member | ✅ |
| `GET/PUT /notifications/preferences` `{ weeklyDigest, push, kinds, timezone }` · `GET /notifications/digest/preview` (what this week's e-mail would say) | auth | ✅ |
| `GET /notifications/push` → `{ publicKey, devices }` · `POST /notifications/push/subscriptions` `{ endpoint, keys: { p256dh, auth } }` (push services only) · `POST …/push/unsubscribe` `{ endpoint }` · `POST …/push/test` | auth | ✅ |
| `GET /families/:familyId/lineages?side=maternal\|paternal` — every line on that side with its people, totems, the people it is recorded on, and differences from the inherited line · lines also appear on profiles (`lineage`) and tree nodes | member.view | ✅ |
| `GET /families/:familyId/events?ceremonies=true` — ceremonies; events take `programme`, `roles` (`{ role, memberId? , name? }`) and `fundId` | member.view / event.manage | ✅ |
| `GET/POST /families/:familyId/funds` · `GET/PATCH/DELETE …/funds/:id` · `GET …/funds/mine` (own contributions) | finance.view / finance.manage | ✅ |
| `GET/POST …/funds/:id/contributions` (amounts in minor units) · `PATCH/DELETE …/contributions/:cid` · `GET …/funds/:id/report?period=YYYY-MM\|YYYY` (by branch, by month, dues per payer) · `GET …/funds/:id/export` (CSV) | finance.view / finance.manage | ✅ |
| `PATCH /families/:familyId/memberships/:id` also takes `{ treasurer }` | membership.manage | ✅ |
| `GET /families/:familyId/books` (own books) · `POST …/books` (BookOptions → `202`, queued; one at a time per person) · `GET …/books/:id` · `GET …/books/:id/download` (→ signed PDF link) · `DELETE …/books/:id` | member (own books only) | ✅ |
| `GET /config` → `{ mapTiles: { url, attribution, maxZoom } \| null, transcription }` — what the server offers the web app | public | ✅ |
| `GET /families/:familyId/places` → `{ places (with counts), flows (generation and lifetime moves between places), suggestions (place names used but not recorded) }` · `GET …/places/:id` → the place, people born, from and died there, events there | member | ✅ |
| `POST /families/:familyId/places` · `PATCH/DELETE …/places/:id` — a name or other name already used by another place is refused (409) | event.manage | ✅ |
| `PUT /families/:familyId/media/:id/tags` `{ version, tags: [{ memberId, box: { x, y, w, h } }] }` — photos only; boxes are fractions within the photo; tags of people the editor cannot see are kept | media.delete (own uploads, or moderators) | ✅ |
| `PUT /families/:familyId/media/:id/transcript` `{ version, text, language?, translation? }` (empty text removes it) · `POST …/media/:id/transcribe` `{ translate }` → 202; refused (409) when no speech service is set up, a run is pending or a typed transcript exists; 413 above `TRANSCRIPTION_MAX_MB` | media.delete (own uploads, or moderators) | ✅ |
| `GET /account/export` — everything held about the account · `POST /account/delete` `{ password }` — erases personal data, ends memberships (refused while the only administrator of a family) | auth | ✅ |
