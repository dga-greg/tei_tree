# Phase 6 — Collaboration: what was built and how it was verified

## Delivered

**E-mail verification** — a 24-hour link is sent at registration (token stored hashed; it verifies only the address it was sent to). Signing in does not need it; accepting an invitation and claiming a profile do. A banner in the app and a badge in Settings remind unverified users, with "send the link again" (rate limited).

**Invitations** (`backend/src/modules/invitations`) — administrators invite relatives by e-mail with a role, an optional personal message and an optional suggested profile. Tokens are random, stored as hashes, expire after 14 days, and travel in the request body (`POST /invitations/preview`, `/accept`), never in a URL path. Accepting requires being signed in with the invited, verified address; it creates (or reactivates) the membership and, when a profile was suggested and is unclaimed, files a claim for review. Invitations can be resent or revoked. The public accept page shows who invited you to which family and leads through account creation, verification and joining, keeping the return address throughout.

**Suggestions and review** (`backend/src/modules/contributions`) — members who cannot change a record directly propose: new relatives (with their links), corrections, removals, new or changed links, link removals, and profile claims. Moderators (in their branches) and administrators review:
- each suggestion shows the people involved and a field-by-field **now → suggested** table, plus a discussion thread;
- **approve** applies the change through the same services as a direct edit, so every integrity rule, the generation recalculation and the audit log apply; the audit entry links back to the suggestion;
- **stale detection**: if the record changed after the suggestion was made, the reviewer is warned and must approve explicitly;
- **ask a question** / **respond** (with an optionally revised proposal), **decline** (reason required, shared with the proposer), **withdraw**;
- nobody reviews their own suggestion; branch moderators see only suggestions touching their branches; others see only their own;
- the proposer is e-mailed the decision.

**Profile claims** — "This is me" on an unclaimed profile files a claim (one open claim at a time). Once approved, the account is linked to the profile and the person can edit their own **personal details** (preferred name, biography, work, education, achievements, contact, nationality, hometown, privacy) directly; changes to names, dates and life status still go through review. The edit page splits a mixed edit automatically: personal fields save, the rest become a suggestion.

**Profiles** — the actions adapt to the viewer: Edit · Edit my profile · Suggest a correction; Remove · Propose removal (with a reason); This is me; History (administrators); relatives can be linked or added as suggestions, and links proposed for removal.

**Members & roles** — administrators change roles (member, moderator, administrator), limit moderators to branches, unlink a claimed profile, remove members; members can leave. The last administrator can never be demoted, removed or leave.

**Change history and restore** — administrators see every change with who/when, readable field changes and a link to the originating suggestion; can filter to one person; **undo** edits and removals of people and links (undo is itself audited and re-checks integrity); and restore removed people together with the links removed at the same moment, skipping links that would now conflict.

**Dashboard** — "Open suggestions" counts what waits on the viewer (to review, or their own in progress); the invite quick action is live.

## Verification

| Check | Result |
|---|---|
| Collaboration integration tests (real MongoDB): invitation create/preview/accept with e-mail match and verification, revoke/resend/expiry; corrections, new relatives and new links approved and applied through the integrity rules; a removal proposal used for the question/answer/decline flow; stale approval needs `force`; self-review forbidden; branch scoping for moderators (404 outside scope); clarification round trip; decline needs a reason; claims (verified only, one at a time, link on approval, own-profile edit allowed for personal fields and refused for genealogical facts); memberships with last-admin protection; audit undo and trash restore | 16 passing |
| E-mail verification tests (a link confirms the address once; a new link replaces older ones) | 2 passing; **218 backend tests in total** |
| Frontend unit tests (incl. working out which fields a suggestion changes) / contracts | 25 / 23 passing |
| Playwright against the live API | admin registers → banner → verifies → invites Kojo → Kojo opens the link, creates an account, is asked to verify, verifies, accepts and joins → suggests Yaw's hometown Kumasi → Accra with a note → claims his own profile → admin sees "Open suggestions", reviews the now → suggested table and approves both → Yaw's hometown is Accra → Kojo edits his biography directly → Members & roles shows the linked profile → History shows both changes "from a suggestion" → **Undo** restores Kumasi → per-person history → phone layout. No console errors. |

## Not covered by automated tests yet

Approving `relationship.update` and `relationship.delete` suggestions goes through the same service calls as the tested kinds. *Covered since Phase 8 by the end-to-end suite (`e2e/tests/collaboration.spec.ts`).*
