# Phase 2 — Family Registry: what was built and how it was verified

## Delivered

**Families**
- Register a family (name, description, history, origin, privacy, adoptive-descent policy) with an optional founding ancestor, all in one transaction. The creator becomes `family_admin`; the founder becomes Generation 1. Unique URL slugs.
- Update details and privacy with optimistic concurrency (`version`); change the founding ancestor (audited, with a reason). Generation numbers for everyone other than the founder stay `pending` until the generation engine (Phase 3).
- Platform administrators can list family registrations (names, owners, counts — never people) and suspend or reactivate them.

**People**
- Full profiles: names (title, middle, preferred, maiden, previous), voluntary gender, living/deceased/unknown, **approximate dates** (`exact | about | estimated | before | after | between`, or a description only), places, nationality, hometown, biography, occupations, education, achievements, sources, private contact details and per-person privacy.
- Validation: impossible dates, ranges that end before they start, death before birth, a living person with death details, and making a living person public are all rejected with field-level errors.
- Create a person and their parent/child/partner links atomically; edit with optimistic concurrency; soft-delete a person with their relationships (the founder and claimed profiles are protected).
- **Search**: every name part is indexed with its prefixes (partial matches) and a phonetic key tuned for Ghanaian and English names (Kwame/Quame/Kwamé, Mensah/Mensa, Asante/Ashanti, Akosua/Akossua). Exact spellings rank above sound-alikes. Filters: status, hometown, birth year, generation; sorting by name, birth, generation or recency; pagination.
- **Privacy** (see [03-PERMISSIONS.md](03-PERMISSIONS.md) §3.4): guests see only public deceased people; restricted profiles are names-only for members; children's dates are reduced to the year and their birthplaces hidden; contact details only for administrators and the person themselves; filters cannot reveal withheld details.

**Relationships**
- Parent–child (biological, adoptive, step, foster, guardian, unknown) and partnership (marriage, customary marriage, civil union, partnership, engagement) with status, dates, verification and sources.
- Integrity rules enforced in transactions: same family, no self-links, no duplicates, **no cycles of any length** (`$graphLookup`), at most two biological parents, parent and partner cannot coincide, subtype must match type. Relationship writes in a family are **serialised** (a per-family revision counter forces concurrent transactions to conflict), so two simultaneous requests cannot together create a cycle.
- Profiles show parents, partners, children and **derived siblings** classified as full, half, or step/adoptive.
- Every change is written to the audit log with before/after values.

**Frontend**
- Register-a-family page (family details, visibility, founding ancestor), family settings (details, privacy, adoptive policy, change founder with a person picker).
- Family members page: search-as-you-type with spelling variations, filters, sorting, pagination, generation badges (always labelled, never colour alone).
- Member profile: life facts, biography, work and education, sources, private contact card, relatives with relationship type and certainty, link an existing person (accessible combobox) or add a new relative pre-linked, remove links and people with confirmation dialogs.
- Add/edit person form with an approximate-date input, privacy and contact sections, server errors mapped to fields.
- "Family Members" and "Family Settings" (administrators) are now live in the navigation.

## Verification

| Check | Result |
|---|---|
| `contracts` unit tests (permissions, dates, name normalisation and phonetic matching) | 23 passing |
| `backend` integration tests against a real MongoDB replica set — 38 new tests for families, people, privacy per role, search and every relationship integrity rule, including concurrent cycle attempts | 81 passing |
| `frontend` unit tests (refresh interceptor, guards, errors, date form, person form, labels) | 14 passing |
| Playwright run in Chromium against the live API | register → register family with founder (G1) → add a child, a partner and another child from the founder's profile → link the partner as the second child's parent through the person picker → sibling shown as **half-sibling** → attempt to make a grandchild the founder's parent: **rejected** ("would make someone their own ancestor") → member list → search "quame" finds Kwame → edit biography → family settings → mobile profile. No console errors. |

## Not yet (by design)
- Generation numbers beyond the founder (Phase 3 engine), branches and branch-scoped moderators (Phase 4).
- Proposals from ordinary members (Phase 6) — they currently receive a clear "must be reviewed" message.
- Profile photographs (Phase 7).
