# Phase 5 — Relationship Finder: what was built and how it was verified

## Delivered

**Kinship engine** (`backend/src/modules/kinship/kinship-engine.ts`) — pure and exhaustively tested:
- **Blood relationships** through birth and adoptive links: closest common ancestor(s), generations from each side, and the name — parent / grandparent / great-… (any depth, "3× great-grandfather"), child / grandchild, sibling, aunt / uncle and great-aunt / great-uncle, nephew / niece and grandnephew / grandniece, **cousins with degree and removal** ("second cousin once removed"), and **half-relations** (half-brother, half-uncle, half-first cousin).
- **Full or half is never assumed**: when a parent is missing from the record the answer says it cannot be known.
- **By marriage**: husband / wife / partner (former when divorced or separated), in-laws (parent-, child-, sibling-, grandparent-in-law), aunt/uncle and nephew/niece by marriage, step-parent / step-child / step-sibling / step-grandparent, directly recorded step, foster and guardian links, and a plain description for other single-marriage connections ("first cousin once removed of Abena's husband").
- Gendered words only when gender is recorded; otherwise neutral wording ("parent's sibling", "sibling's child").
- The **actual chain of people** with labelled steps ("Kojo's father → Yaw …"), the reciprocal term, a one-sentence summary and a plain-language explanation of how it was worked out.
- **Confidence**: disputed links are ignored; unverified links are used but flagged. Adoption on the path and blood relatives who are also partners (e.g. cousin marriage) are reported.
- When nothing connects two people, it says so and suggests what might help — it never invents a relationship.

**API** — `GET /families/:id/relationships/between?a=&b=` (family members only). The family's links are cached in memory per family and invalidated automatically by any relationship change.

**Frontend**
- **Relationship Finder page**: two person pickers (with swap), shareable URL (`?a=&b=`), the answer as a sentence plus the reciprocal, badges (blood / marriage / step, all links verified or not, adoption, half, also partners), the path as a chain of people (horizontal on desktop, vertical on phones), the closest common ancestors and the explanation.
- **"Show this path in the family tree"** opens the tree with every person on the path loaded, expanded and highlighted.
- **"How are we related?"** on every profile; the finder is live in the navigation and on the dashboard.

## Verification

| Check | Result |
|---|---|
| Kinship engine: 62 table-driven cases (direct line to 3× great, siblings and half-siblings, aunts/uncles to great-great, nephews/nieces to great-grand, first and second cousins with removals up to three times, half-first cousin, neutral wording, adoption, spouses including former, step-parent / step-brother / step-grandparent, foster, every in-law case, by-marriage cases) plus 16 behaviour tests (reciprocal, common ancestors, explanations, path labels, in-law path, missing parent → unknown full/half, unverified and disputed links, adoption flag, cousin marriage, single-marriage description, no chaining of two marriages, not found, self, a 21 845-person family) | 78 passing |
| API integration (real MongoDB): cousin with path and ancestor, in-laws, cache invalidated by a new link (stepson → son), not connected, guests / outsiders / unknown ids / missing parameter, cross-family isolation | 6 passing; **200 backend tests in total** |
| Frontend unit tests / contracts | 24 / 23 passing |
| Playwright against the live API | 10-person family → Kojo and Kobina are **second cousins once removed** via Kofi Mensah and Akosua Owusu with the 8-person chain shown → swap → Adwoa is Abena's **aunt by marriage** → path opened and highlighted in the tree → "How are we related?" from Ama's profile: **great-aunt** → phone layout. No console errors. |
