# Phase 4 — Interactive Family Tree and Branches: what was built and how it was verified

## Delivered

**Graph windows (API)** — the tree is never sent whole. Endpoints return the founder (or a branch, or any person) with N generations below, one person's children when expanding, or a person's ancestors for search-and-focus, always with partners and every edge between the people included, plus each person's total number of parents and children so the client knows what can still be expanded. A window stops at 1 500 people. Privacy rules apply: guests see only public deceased people, and relative counts never reveal hidden people.

**Layout** (`frontend/src/app/features/tree/layout.ts`) — a pure, unit-tested function, not a binary-tree layout:
- **Family units**: a descendant plus the partners who married in, side by side; children hang from the couple they belong to, grouped by co-parent (blended families with several partnerships stay readable).
- Each person is placed once. A second parent elsewhere in the tree (e.g. cousin marriage) is joined with a secondary curve; partners who are both descendants are joined by an arch rather than moved.
- One horizontal band per generation, labelled with the generation number.
- Line styles: birth (solid), adoptive (long dash), step / foster / guardian (dotted), unverified (faded dash), disputed (red), partnership (gold double line; ended partnerships faded); married-in partners have dashed card borders. A legend explains them.

**Tree page** — three panels on desktop (controls · tree · selected person); on phones the controls become a focus-trapped drawer and the person panel a bottom sheet.
- Zoom and pan (D3), zoom buttons, fit to screen, reset, full screen. Large trees open at a readable scale centred on the founder instead of as an unreadable thumbnail.
- Expand / collapse any person (“+N” / “−”), fetching children on demand.
- Search by name (partial and phonetic) and focus: the line from the root is loaded and opened, the person is selected and centred. People not connected to the root get a clear explanation.
- Highlight ancestors or descendants of the selected person; highlight a generation; switch to a branch; choose how many generations to load.
- Export the whole tree (not just the visible part) as **SVG, PNG or PDF** (A3, print resolution).
- Only cards and lines in or near the viewport are rendered, so large trees stay responsive. Cards are keyboard-focusable buttons with descriptive labels; the person panel offers parents, partners, children and siblings to jump to.

**Branches**
- Create a branch from any person, or one per child of the founding ancestor in one step. Branch membership is **derived** (the founding member and their descendants by the same descent rule as generations); people are never copied, and one person can be in several branches.
- Statistics per branch — descendants, generations spanned, living — recomputed with every generation recalculation from the same in-memory graph.
- Branches page with “View in tree” and “People” (the member list filtered by branch); member list branch filter; branch count on the dashboard.
- **Branch-scoped moderators** are now enforced: they can edit, add and link people only inside their branches.

## Verification

| Check | Result |
|---|---|
| Layout unit tests: bands and levels, centring and birth order, married-in partners beside their spouse, blended family grouped by co-parent, cousin-marriage child placed once with a secondary link and a partner arch, adoptive / step links, collapse and not-yet-loaded children, unconnected people, 341-person tree without overlaps | 10 passing (24 frontend total) |
| Backend integration: tree windows (depth, partners, edge kinds, counts, expand, ancestors, validation, guest privacy), branches (from founder's children, statistics kept current, member filter, branch tree, uniqueness, admin-only management), branch-scoped moderators (allowed inside, refused outside, unrestricted moderators) | 10 new; 116 backend total |
| Playwright against the live API | 41-person family with two marriages for the founder, adoption and 6 generations → tree opens readable → select founder (panel shows partners and children) → search “ato” focuses a 6th-generation person not initially loaded and highlights his ancestors → collapse and re-expand Kwame with the keyboard → generation highlight → SVG (41 KB), PNG (8312×2212) and PDF (306 KB) exports → branches created for the founder's three children with statistics → branch opened in the tree → dark theme → phone layout with bottom sheet. No console errors. |

## Not yet (by design)
- Relationship path between two people in the tree (Phase 5).
- Profile photographs on cards (Phase 7) — initials are shown.
