# 6. UI Component Architecture

## 6.1 Principles

* **Standalone components only**, `ChangeDetectionStrategy.OnPush`, zoneless change detection, state in **signals** (`signal`, `computed`, `effect`), RxJS only at the HTTP boundary.
* **Feature-based directories**, each feature lazily loaded through `loadComponent` / `loadChildren`.
* **Smart vs. presentational:** route components ("pages") inject stores and services; `shared/ui` components take inputs and emit outputs only.
* **Typed API layer:** every request and response type comes from `@fh/contracts`.
* **Accessibility:** semantic landmarks, visible focus rings, labelled form controls with error text linked by `aria-describedby`, `prefers-reduced-motion` respected, colour never the only signal (generation colours are paired with a "G3" label). CDK provides focus traps (drawers, dialogs), live announcer and a11y helpers.
* **Design tokens** in Tailwind v4 `@theme`: neutral surfaces, one brand accent (deep green, kente-inspired gold as secondary), and an 8-step generation accent scale with WCAG-checked contrast on white.

## 6.2 Application shell

```
AppComponent
└── RouterOutlet
    ├── AuthLayout                          (/auth/** — centred card, brand panel)
    │   ├── LoginPage · RegisterPage · ForgotPasswordPage · ResetPasswordPage
    └── ShellLayout                         (authenticated area, authGuard)
        ├── SidebarNav  (desktop: persistent; mobile: CDK-trapped drawer)
        ├── TopBar      (family switcher, search entry, user menu)
        ├── Tour        (welcome tour over the dashboard; see below)
        └── RouterOutlet
            ├── DashboardPage
            ├── FamilyTreePage              (Phase 4)
            ├── MembersPage / MemberProfilePage (Phase 2)
            ├── GenerationsPage             (Phase 3)
            ├── BranchesPage                (Phase 4)
            ├── RelationshipFinderPage      (Phase 5)
            ├── FamilyHistoryPage (timeline, stories) · StoryPage · StoryEditPage · MediaPage
            ├── InvitationsPage · ContributionsPage · MembersAccessPage · HistoryPage
            ├── AdminPage                   (platform: superAdminGuard)
            └── SettingsPage
```

Navigation items for later phases are shown but **disabled with a "Coming in Phase N" label** and routed to an honest placeholder; nothing pretends to work.

### Welcome tour and first steps

The first time someone opens the dashboard with a family, a six-step tour (`layout/tour.component.ts`, steps in
`core/tour/tour.service.ts`) dims the page and points at, in turn: the family switcher, *Add family member*, *View family
tree*, the menu (the sidebar on computers, the ☰ button on phones) and the account menu. Elements opt in with
`data-tour="<name>"`; a step whose element is not visible (no permission, hidden on this screen size) is left out. On
phones the card runs along the top or bottom edge, away from the element. Escape, *Skip tour* and *Done* all end it, and
the account remembers it (`preferences.tourSeen`), so it is not offered again on any device. *Take the tour* in the
account menu replays it. E2E tests switch it off with the `fh.tourSeen` local-storage flag in `playwright.config.ts`.

While a family has only its founding ancestor, the dashboard shows a *Start your family tree* card (add people, invite
relatives, import a GEDCOM file) and the tree page a prompt to add the founder's partner and children. An empty month in
the calendar links to the people's profiles, where dates are recorded.

### Start-up speed

Measured on a throttled phone (slow 4G, 4× slower processor), production build: the dashboard's figures appear
after about 3.5 s on a first visit and 1.0 s on a repeat visit (before these measures: 3.95 s and 1.4 s). What keeps
start-up short, so each step does not wait for the one before:

- `scripts/modulepreload.mjs` (run by `npm run build`) adds `modulepreload` links for every start-up file. Angular
  adds at most 10, and the largest (Angular itself, the icons) were often left out, costing a second round trip. It
  also updates the service worker's hash of `index.html`.
- `main.ts` starts downloading the shell and the dashboard code at once when this device was signed in
  (`fh.signedIn` in local storage, kept by `AuthStore`), instead of after the session check.
- The app initializer asks for the families as soon as the session is confirmed, and, opening on the dashboard, its
  figures (`GenerationsApi.prefetchDashboard`, taken by the page's first request). The shell uses
  `FamilyContextStore.ensureLoaded()`, which reuses that request.
- Chart.js (the largest part of the dashboard) is loaded by `BarChartComponent` when it first draws, so the figures do
  not wait for it.

The icons cost about 30 ms of processing on that phone, so they are not worth replacing.

## 6.3 State

| Store (signal-based service, `providedIn: 'root'`) | Holds |
|---|---|
| `AuthStore` | `user`, `status: 'unknown' \| 'authenticated' \| 'anonymous'`, `isSuperAdmin`, login/logout/register/refresh |
| `FamilyContextStore` | the families list, `activeFamilyId` (persisted per user), `activeRole`, `can(permission)` using the shared matrix |
| `TreeStore` (Phase 4) | loaded node/edge window, expanded set, selection, filters, viewport transform |
| `RelationshipStore` (Phase 5) | selected pair, result, path |

## 6.4 HTTP layer

* `provideHttpClient(withFetch(), withXsrfConfiguration({cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN'}), withInterceptors([apiBaseUrl, credentials, authRefresh]))`.
* `authRefresh` interceptor: on `401` with code `UNAUTHENTICATED`/`SESSION_EXPIRED` from a non-auth endpoint, performs **one** shared refresh (concurrent 401s wait for the same refresh) and retries once; on failure the store becomes anonymous and the router navigates to `/auth/login?returnUrl=…`.
* `ApiError` normalises the server error envelope; forms map `details[].path` onto controls.

## 6.5 Family tree visualisation (Phase 4)

* `FamilyTreePage` hosts three regions: `TreeSidebar` (filters, branches, display settings), `TreeCanvas` (D3), `MemberPanel` (selected person). Below `lg` the sidebars become CDK drawers / a bottom sheet.
* `TreeCanvas` is a thin Angular wrapper; layout is a **pure function** `layoutFamilyGraph(nodes, edges, options) → positioned nodes, family units, routed links`, so it can be unit-tested without a DOM.
* Layout model: **family units** (a couple or single parent) instead of a binary tree. Each generation is a horizontal band (tinted with the generation accent). Children hang from the midpoint of their parents' union line; additional partners are placed beside the shared person with separate union connectors; multiple parental sets (birth + adoptive) are drawn as separate connectors with distinct line styles. Married-in partners are drawn in the band of their partner.
* Line styles (legend): biological = solid, adoptive = dashed, step/foster/guardian = dotted, partnership = double line, ended partnership = faded double line, unverified = lighter with "?" marker.
* Rendering: SVG for ≤ ~1 500 visible nodes with off-viewport culling; D3 zoom/pan; incremental expansion via the "expand node" endpoint; export via serialising the SVG (SVG), drawing to canvas (PNG) and jsPDF (PDF).
