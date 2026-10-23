# Phase 3 — Generation Engine: what was built and how it was verified

## Delivered

**Engine** (`backend/src/modules/generations/generation-engine.ts`) — a pure function implementing [04-GENERATION-ENGINE.md](04-GENERATION-ENGINE.md):
- Founder = Generation 1; child = parent + 1, over **verified** biological links, plus adoptive links when the family's policy allows (default on). Step, foster and guardian links never count.
- Every person is classified: `founder`, `computed`, `conflict` (with candidate numbers), `unverified_path` (connected only through unverified links — provisional number shown), `married_in`, `unconnected`, or `pending` (no founder chosen).
- **Conflicting paths are flagged, never guessed.** Conflicts propagate to descendants. An administrator can choose one of the candidates with a reason (audited); everything below renumbers. Invalid or stale choices are rejected or ignored.
- Independent of birth year. Defends against cycles in corrupted data. ~20 000 people in well under 2 seconds.

**Recalculation**
- Triggered automatically after every committed change that can affect numbers or statistics (relationships, people, founder, adoptive policy, overrides).
- Inline for families up to `GENERATION_INLINE_LIMIT` (default 2 000) so responses already show the new numbers; larger families go through a de-duplicated BullMQ job processed by the worker. A per-family state (`idle / pending / running`) guarantees a change made during a run triggers another run.
- Only changed people are written (`bulkWrite`); each run stores a **generation snapshot** used for statistics and trends.

**API** — generation summary, daily trend, conflicts (open and resolved), manual recalculation, resolve/undo a conflict, family dashboard, and `generation` / `generationStatus` filters on the member list. Generation statistics are for family members only because they include counts of living people.

**Frontend**
- **Generations page**: totals (generations, people numbered, conflicts, married in, not connected), stacked chart of living / unknown / deceased per generation with hover tooltips, the same figures as a table with recorded birth-year ranges and a link to each generation's people, and the conflict review panel (resolve with a reason, undo). Shows "Recalculating…" and refreshes while the worker runs.
- **Family dashboard**: quick actions, statistic tiles (branches and pending contributions say which phase delivers them instead of showing 0), members per generation (with table view), recently added people, monthly growth over the last year.
- **Members page**: filter by generation number and generation status (e.g. "Conflicting paths", "Married into the family"); links from the generations table land there pre-filtered.
- Charts use a palette checked with the colour validator for both themes (living / unknown / deceased, adjacent colour-blind ΔE ≥ 20); generation badges have dark-theme variants and always carry a text label.

## Verification

| Check | Result |
|---|---|
| Engine unit tests: numbering, unlimited depth, married-in, unconnected, ancestors above the founder, verified / unverified / disputed links, adoptive policy on and off, step/foster/guardian, cousin-marriage conflict and its propagation, overrides (valid, stale, on non-conflicts), equal paths, independence from birth year, founder change, no founder, cycles, statistics, a 19 531-person family | 17 passing |
| API integration tests (real MongoDB replica set): automatic numbering on add, classification, recalculation on verification / removal / policy change, conflict → resolve → descendants renumbered → undo, founder change, summary / trend / dashboard figures, guests and non-admins denied | 8 new; **106 backend tests passing** |
| Contracts / frontend unit tests | 23 / 14 passing |
| Playwright run against the live API **with `GENERATION_INLINE_LIMIT=0`**, so every recalculation went through Redis and the worker | 38-person, 5-generation family seeded through the API (including a cousin marriage across generations and an unverified link) → worker settled with 2 conflicts, 4 married in → dashboard tiles and charts → generations chart tooltip → resolve Kweku as G4 with a reason → his child renumbered automatically and dropped from the conflict list → "View people" for G3 lists 9 → dark theme. No console errors; no failed jobs in the worker log. |

## Not yet (by design)
- Branches and branch statistics (Phase 4); pending contributions (Phase 6) — the dashboard says so explicitly.
