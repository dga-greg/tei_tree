# Security review (Phase 8)

A review of the whole application before deployment: what was checked, what was found and fixed, and the
risks that remain by decision. Automated checks that guard these properties are listed with each area, so
regressions show up in CI.

## Summary

| Area | Result |
|---|---|
| Dependencies | **Fixed.** `npm audit` reported a critical (jsPDF ≤ 4.2.0) and a high (nodemailer ≤ 10.0.5) vulnerability. Upgraded to jsPDF 4.2.1 and nodemailer 10.1.2; `npm audit` now reports 0 for all dependencies. CI fails on new high/critical advisories in production dependencies. |
| Authorisation (family data) | **Verified.** An automated sweep calls all 75 family routes as an outsider and as an anonymous visitor of a private family: every one answers 404 (the family's existence is not revealed). |
| Robustness | **Verified.** The same sweep sends malformed ids, unknown ids and an injection-shaped id with empty bodies to every route as an administrator: no server errors. |
| Injection | **Verified.** All input is validated with strict Zod schemas (unknown fields are refused, so no mass assignment). Express 5's simple query parser never builds objects from `a[$ne]=…`, so query operators cannot reach MongoDB; repeated parameters are refused by validation; search text is escaped before use in regular expressions. |
| Secrets in logs | **Fixed.** Signed file links are short-lived credentials but appeared in request logs; they are now redacted (`/api/v1/files/[redacted]`) in access and error logs. Cookies, CSRF tokens and passwords were already redacted. |
| Request size | **Fixed.** The 100 KB JSON limit was smaller than the longest story allowed (100 000 characters of UTF-8); raised to 1 MB, still bounded. Uploads have their own streamed limit. |
| File uploads | Covered in Phase 7: content sniffing, re-encoding without metadata, size limits while streaming, private storage, signed short-lived links, sandboxing headers. |
| Web app headers | **Added** with the deployment configuration (`deploy/nginx.conf.template`): Content-Security-Policy (scripts only from the app's origin), `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` (invitation and reset links carry tokens in the address), `nosniff`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. |
| Deletion and export | Destructive actions need the password (and, for a family, its exact name); exports are limited to administrators (family) or the account holder (personal data), and family exports are recorded in the change history. |

## Checklist

**Authentication and sessions** — Argon2id with OWASP parameters and a dummy verification for unknown
accounts (no timing difference); per-account lockout and per-IP limits; access tokens are HS256 JWTs whose
algorithm, issuer and audience are pinned on verification; refresh tokens rotate with reuse detection and live
on a cookie path limited to the auth endpoints; all cookies `HttpOnly`, `SameSite=Strict`, `Secure` in
production (enforced at start-up); password change and reset revoke other sessions; deleted and suspended
accounts are refused on every request.

**CSRF** — signed double-submit token on every state-changing request; GET endpoints change nothing (file
links and exports are GET but only read, and cookies are `SameSite=Strict`).

**Authorisation** — one permission matrix (`contracts/src/permissions.ts`) enforced by the API, with
per-record checks in services (branch scope, ownership); profile redaction for guests, restricted profiles,
minors and private contact details; archive privacy; platform administrators see no family records (abuse
reports show only what was reported).

**Open redirects** — `returnUrl` only accepts same-app relative paths.

**Transport and headers** — the API sends `default-src 'none'` CSP, `nosniff`, `no-store`, no
`X-Powered-By`, no CORS headers (the SPA and API share an origin). HSTS is expected from the TLS terminator in
front of the web container.

**Rate limiting** — global, credential, upload and file-link limiters, Redis-backed in production.

**Data protection** — personal-data export and account deletion; family deletion with a grace period and a
purge that erases records and stored files; removed files are erased after the retention period.

## Accepted risks

- **Account enumeration at registration.** Signing up with an existing address says so, which reveals that an
  account exists. Password recovery does not reveal it. Registration is rate-limited; hiding it would need
  e-mail-first sign-up, a larger UX change.
- **Web fonts from Google Fonts.** The app loads Fraunces and Sora from `fonts.googleapis.com`, which tells
  Google the visitor's IP address. Self-hosting the fonts would remove the third party (and the CSP entries for
  it).
- **`style-src 'unsafe-inline'`.** Angular binds style attributes, which a strict style policy would block.
  Scripts remain strictly limited to the app's own files.
- **Family exports include living people by default.** It is the family administrators' own backup; the
  "Replace living people" option is offered for copies shared outside the family.
- **Audio, video and PDF files are not scanned or rewritten.** They are type-checked, stored privately and
  served with `nosniff` and sandboxing headers; adding a malware scanner is recommended where families upload
  many documents.
