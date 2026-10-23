# Phase 13 — Accounts: what was built and how it was verified

## Delivered

**Two-step sign-in** (Settings → Security)
- Turn it on with your password, scan the QR code with any authenticator app (Google Authenticator, Microsoft
  Authenticator, 1Password, Authy…) or type the key, and confirm with the first code. Ten **recovery codes** are
  shown once, to copy or download; each works once.
- Signing in then asks for the 6-digit code after the password ("Lost your phone? Use a recovery code").
- New recovery codes and turning it off need the password and a code. Turning it on signs out every other device.
  Every change, and every use of a recovery code, is e-mailed to the account holder.
- **Platform administrators must turn it on** before the administration pages work (`ADMIN_MFA_REQUIRED`, on by
  default); the app takes them straight to Settings.
- Safeguards:
  - Authenticator secrets are encrypted at rest (AES-256-GCM, `MFA_ENCRYPTION_KEY`), and recovery codes are stored
    as keyed hashes. A copy of the database alone yields neither.
  - A code is never accepted twice: the last accepted 30-second step is remembered and updated atomically, so two
    requests racing with one code cannot both succeed. One step of clock drift either way is allowed.
  - The password step returns a single-use challenge (5 minutes, 5 guesses), and no session. Wrong codes count
    towards the existing account lock, so guessing codes is as slow as guessing passwords.
  - A password reset does not switch two-step sign-in off.

**Sign in with Google** (sign-in and sign-up pages; Settings → Security)
- OpenID Connect authorization-code flow with PKCE, `state` and `nonce`, carried in a signed, 10-minute,
  `SameSite=Lax` cookie scoped to the Google routes. The ID token's signature is checked against Google's
  published keys, along with its issuer, audience, expiry and nonce.
- **Which account it signs in to:**
  - A Google account signs in to the account it is linked to.
  - A new address gets a new account, already confirmed. It has no password until the person sets one.
  - It links to an existing account automatically only when that account's address was confirmed with us *and*
    Google vouches for the address: Gmail, or a Workspace domain Google manages. Otherwise the person signs in
    with their password and links Google in Settings, so nobody can take over an account by making a Google
    account with someone else's address.
- Linking from Settings needs the session that started it to still be signed in. A Google account already linked
  to someone else is refused.
- **Accounts made with Google:**
  - They can set a password in Settings without a current one, and must have one before removing Google.
  - Sensitive changes (two-step sign-in, deleting the account or a family) ask such accounts to have signed in
    within the last 15 minutes instead of asking for a password.
- Two-step sign-in still applies after Google. The challenge comes back in the URL fragment, which is never sent
  to a server, and is removed from the address bar at once.
- Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` the button is not shown. Problems coming back from Google
  (cancelled, expired, address needs linking…) are explained on the sign-in page.

**Also**
- Deleting an account erases its authenticator secret, recovery codes and Google link.
- The personal-data export and the change history never contain secrets.
- Deployment: new `MFA_ENCRYPTION_KEY`, `ADMIN_MFA_REQUIRED`, `GOOGLE_CLIENT_*` settings in compose, the examples
  and CI. DEPLOYMENT.md explains how to create the Google OAuth client.

## Verification

| Check | Result |
|---|---|
| Backend (unit + integration, real MongoDB) | **309 passing**. New: the RFC 6238 test vectors, the drift window and replay; sealed secrets refuse tampering and other keys; safe return paths; Google ID tokens (signature, forged key, audience, issuer, expiry, nonce) against a locally generated key. Through the API: turning on, with a wrong first code and a pending secret stored encrypted; the code step without a session; replayed codes refused across sign-ins; single-use challenges; five guesses per challenge and the account lock; recovery codes once each, with e-mails, and replaced by new ones; turning off; administrators refused (`MFA_REQUIRED`) until it is on. Google, with a stand-in that checks PKCE and nonce: new accounts, flow cookie attributes, wrong or missing state, cancelling; linking only when both sides vouch for the address (unconfirmed, non-Google and Workspace addresses); linking from Settings, a Google account in use elsewhere, unlinking; accounts without a password setting one and deleting themselves after a recent sign-in; the code still asked for after Google; the feature off without a client |
| Frontend unit / contracts | 32 / 23 passing |
| End-to-end (Playwright) | **21 passing**. New journeys: turn on two-step sign-in from Settings (a wrong code first, then the code computed from the shown key); sign out and in with a code; sign in with a recovery code, which then fails a second time; turn it off with a recovery code; sign in with the password alone. Messages after Google and an expired two-step link are also checked. A race in an older journey (leaving the e-mail confirmation page before it had confirmed) was fixed |

Real Google sign-in cannot run in the test environment; the Google side is covered by the stand-in and the
ID-token checks above. Try it once with a real OAuth client before relying on it.
