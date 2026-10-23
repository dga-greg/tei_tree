# 3. Roles and Permissions

The executable matrix lives in `contracts/src/permissions.ts` and is imported by both the backend (enforcement) and the frontend (hiding controls). **Only the backend decides.**

## 3.1 Roles

| Role | Scope | Stored on |
|---|---|---|
| Super Administrator | Platform | `users.platformRole = 'super_admin'` |
| User | Platform (default) | `users.platformRole = 'user'` |
| Family Administrator | One family | `family_memberships.role = 'family_admin'` |
| Family Moderator | One family, optionally limited to branches | `family_memberships.role = 'family_moderator'` + `moderatedBranchIds` |
| Family Member | One family | `family_memberships.role = 'family_member'` |
| Guest | — | no active membership (anonymous or signed-in non-member) |

A user can hold a different role in each family. Platform role and family role are independent: a super admin with no membership is a **guest** in that family.

## 3.2 Family permission matrix

✅ allowed · 🌿 allowed within assigned branches (all branches if none assigned) · 📝 only by submitting a contribution for review · 🌐 public data only · — denied

| Permission | Admin | Moderator | Member | Guest |
|---|:-:|:-:|:-:|:-:|
| `family.view` | ✅ | ✅ | ✅ | 🌐 (if family is public) |
| `family.update` (name, description, origin, emblem) | ✅ | — | — | — |
| `family.export` (GEDCOM / JSON copy of the whole family) | ✅ | — | — | — |
| `family.delete` (with password and the family's name; restorable during a grace period) | ✅ | — | — | — |
| `family.manage_privacy` | ✅ | — | — | — |
| `family.set_founder` (+ recalculation) | ✅ | — | — | — |
| `member.view` | ✅ | ✅ | ✅ (redacted per privacy) | 🌐 deceased & public only |
| `member.view_private` (contact, exact living DOB) | ✅ | 🌿 | own claimed profile | — |
| `member.create` | ✅ | 🌿 | 📝 | — |
| `member.update` | ✅ | 🌿 | 📝 (own profile: direct for non-genealogical fields) | — |
| `member.delete` | ✅ | 📝 | 📝 | — |
| `relationship.manage` | ✅ | 🌿 | 📝 | — |
| `contribution.submit` | ✅ | ✅ | ✅ | — (may request invitation) |
| `contribution.review` | ✅ | 🌿 | — | — |
| `invitation.manage` | ✅ | — | — | — |
| `invitation.request` | — | — | — | ✅ |
| `membership.manage` (roles, moderators) | ✅ | — | — | — |
| `branch.manage` | ✅ | — | — | — |
| `media.view` | ✅ | ✅ | ✅ | 🌐 |
| `media.upload` | ✅ | ✅ | ✅ if `privacy.allowMemberUploads` (published after approval) | — |
| `media.delete` (also edit details) | ✅ | ✅ | own uploads | — |
| `story.create` | ✅ | ✅ | 📝 (published after approval) | — |
| `story.manage` (edit, remove) | ✅ | ✅ | own stories | — |
| `event.manage` (timeline events, ceremonies and places) | ✅ | ✅ | — | — |
| `audit.view` | ✅ | — | — | — |
| `record.restore` | ✅ | — | — | — |
| `generation.recalculate` | ✅ | — | — | — |
| `family.import` (GEDCOM import and undoing an import) | ✅ | — | — | — |
| `member.merge` (duplicate finder, merging two records, undoing a merge) | ✅ | — | — | — |
| `finance.view` (funds as each fund allows: totals, or contributions too; always one's own) | ✅ | ✅ | ✅ | — |
| `finance.manage` (create funds, record and correct contributions, reports, CSV) | ✅ | treasurer | treasurer | — |

**Treasurers**: any family member can be made a treasurer (a flag on their membership, set in Members & Roles); a treasurer holds `finance.manage` whatever their role. Funds marked "admins" are invisible (404) to everyone else.

Additional invariants enforced in services:

* Archive items (files, stories, events) have their own privacy: `family`, `admins` (administrators and moderators) or `public`. Guests of public families see only published `public` items that are not about anyone hidden from guests (living or non-public people). Pending and rejected additions are visible only to their author and the reviewers.
* Files are never served from a public URL: every request re-checks permission and redirects to a signed link valid for 5 minutes.
* A family must always have at least one active `family_admin` (the last admin cannot leave or be demoted).
* Admins cannot be removed by moderators; moderators cannot grant roles.
* Changes to a moderator's own claimed profile's genealogical facts (parents, generation) still go through review by another reviewer.

## 3.3 Platform permission matrix

| Permission | Super Admin | User |
|---|:-:|:-:|
| `platform.settings` | ✅ | — |
| `platform.users.view` / `platform.users.manage` (suspend, reactivate, role) | ✅ | — |
| `platform.families.view` (registration metadata & counts only) | ✅ | — |
| `platform.families.manage` (suspend/archive a family registration) | ✅ | — |
| `platform.stats` | ✅ | — |
| `platform.reports.manage` (abuse reports: dismiss, notify the family's administrators, suspend the family) | ✅ | — |
| `family.create` | ✅ | ✅ |

**Super administrators must turn on two-step sign-in** before any `/admin` route answers them (`403 MFA_REQUIRED` otherwise; `ADMIN_MFA_REQUIRED=false` turns the rule off).

**Super administrators never receive `member.view` by virtue of their platform role.** Platform endpoints return family names, status, owner account and aggregate counts, never people.

## 3.4 Enforcement

* `requireAuth` — validates the access token, loads the user, rejects suspended accounts and revoked sessions.
* `requirePlatformPermission(p)` — checks the platform matrix.
* `loadFamilyAccess` — resolves `:familyId`, loads the caller's active membership (if any) and attaches a `FamilyAccess` object `{ family, membership, role, can(permission, branchIds?) }` to the request. Non-existent and inaccessible private families both return **404** so family existence is not disclosed.
* `requireFamilyPermission(p)` — route-level check; branch-scoped checks that depend on the target record are done in the service with `access.can(p, targetBranchIds)`.
* Field-level redaction is applied by `MemberPolicy` (backend `modules/members/member.policy.ts`) using the same `FamilyAccess`:
  * **Guests** see only deceased people whose profile is `public`, in families that are not private. Hidden relatives are omitted, not shown redacted.
  * **Restricted** profiles, and living people when the family turns off `showLivingToMembers`, appear to ordinary members as names and generation only.
  * **Children** (living, born < 18 years ago) and people with `hideDates` show only the year of birth, and children's birthplaces are hidden, except to editors and the person themselves.
  * **Contact details** are returned only with `member.view_private`.
  * Filtering a list by a detail the viewer cannot see (hometown, birth year, status) excludes those people, so filters cannot be used to infer withheld values.
* **Branch-scoped moderators** (`moderatedBranchIds` not empty) may edit a person only if the person belongs to one of their branches — i.e. the branch's founding member is the person or one of their ancestors by descent. A new person is placed by their parents (or partner); a relationship may be changed when either person is in scope. Moderators without assigned branches act across the whole family.
