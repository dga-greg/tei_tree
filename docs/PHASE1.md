# Phase 1 — Project Foundation: what was built and how it was verified

## Delivered

**Shared contracts (`contracts/`)**
- API envelope, error codes, pagination constants.
- Platform and family roles, and the full permission matrix (`canFamily`, `canPropose`, `canPlatform`) used by both sides.
- DTOs for users, auth, families, and the genealogy value types the later phases need (`FuzzyDate`, generation info, relationship types and subtypes).

**Backend (`backend/`)**
- Express 5 + TypeScript (strict, ESM), zod-validated configuration that refuses to start in production without Redis, SMTP, HTTPS origin and secure cookies.
- Mongoose schemas with indexes for **all 13 collections** in [02-DATA-MODEL.md](02-DATA-MODEL.md) plus `auth_sessions` and `password_reset_tokens`. Indexes are built at start-up.
- Authentication: register, login, logout, refresh, forgot/reset password, current user, profile update, change password, list/revoke own sessions.
  - Argon2id hashing (with transparent re-hash when parameters change) and timing equalisation for unknown e-mails.
  - JWT access token (15 min) + opaque rotating refresh token, both HttpOnly `SameSite=Strict` cookies; refresh tokens stored as SHA-256 hashes; **reuse detection** revokes the session; 30-second grace window for concurrent tabs; sliding expiry capped by an absolute session lifetime.
  - Sessions checked on every request, so logout / password change / suspension take effect immediately.
  - Account lockout after repeated failures; credential endpoints rate-limited per IP (Redis-backed when configured).
  - Password reset tokens are single-use, hashed, expire, and invalidate earlier links; a reset signs out every device.
- Signed double-submit CSRF protection on every state-changing request.
- RBAC: `requireAuth`, `requirePlatformPermission`, `loadFamilyAccess` + `requireFamilyPermission`. Private and suspended families return 404 to non-members — **including super administrators**.
- Platform administration: statistics, account list with search/filter/pagination, suspend/reactivate/role change (not on oneself), all audited in `audit_logs`; suspension revokes sessions.
- Families: list my families with role; retrieve a family (guests see only the public face of public families).
- Background worker (BullMQ) delivering e-mail; inline delivery when Redis is absent in development.
- Helmet security headers, `Cache-Control: no-store`, request ids, structured logging with secrets redacted, health endpoints, graceful shutdown.
- `npm run create-super-admin` CLI (super admins cannot be created through the API).

**Frontend (`frontend/`)**
- Angular 21, standalone components, zoneless change detection, signals, OnPush everywhere, lazy-loaded routes, Tailwind CSS v4 design tokens (including the generation accent scale), Lucide icons, Angular CDK (focus trap, menu).
- Auth pages: sign in, create account, forgot password, reset password — with client and server validation messages bound to fields (`aria-describedby`, `aria-invalid`).
- `AuthStore` (signals), single-flight **refresh interceptor** (concurrent 401s share one refresh, one retry), guards (`authGuard`, `guestGuard`, `superAdminGuard`), open-redirect-safe `returnUrl`.
- App shell: persistent sidebar on desktop, focus-trapped drawer on mobile (Escape closes), family switcher with role badge, account menu, skip link.
- Dashboard (my families or an honest empty state), Settings (profile, theme system/light/dark, change password, signed-in devices), Platform administration page.
- Navigation items for later phases are visibly labelled "Phase N" and lead to an explicit "not available yet" page.

## Verification

| Check | Result |
|---|---|
| `contracts` unit tests (permission matrix, fuzzy dates) | 9 passing |
| `backend` tests — unit + integration against a **real MongoDB 7 replica set** (mongodb-memory-server) | 43 passing |
| `frontend` unit tests (refresh interceptor, guards, error mapping) | 9 passing |
| `tsc --noEmit` (backend incl. tests), `ng build` (production) | clean |
| Manual run: API + worker against MongoDB + Redis, Angular dev server via proxy, driven by Playwright (Chromium) | register → dashboard → family switcher → silent session renewal after deleting the access cookie → coming-soon page → dark theme → non-admin blocked from `/admin` → super-admin page → mobile drawer → sign out → `returnUrl` redirect → wrong-password message → sign in. No console errors. The password-reset e-mail was delivered through the BullMQ queue to the worker. |

Not yet done (by design, later phases): e-mail verification (Phase 6), family creation and genealogy features (Phases 2–7), end-to-end test suite in CI and deployment images (Phase 8).
