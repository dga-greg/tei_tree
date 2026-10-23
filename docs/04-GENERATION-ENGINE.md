# 4. Generation Engine and Relationship Engine

## 4.1 Inputs

* `F` — the family's founding ancestor (`families.foundingMemberId`).
* **Descent edges** `D` — `relationships` with `type = 'parent_child'`, `deletedAt = null`, `verification = 'verified'`, and `subtype ∈ {biological}` ∪ (`{adoptive}` if `generationPolicy.countAdoptive`). Step, foster and guardian links never create descent.
* Administrator overrides — `generation.override.number` on a person (only allowed when that person is in `conflict`).

## 4.2 Algorithm

Generation numbers are computed for the **descendant subgraph of F**, which is a DAG because cycles are rejected at write time (the engine still detects them defensively).

```
G(F) = {1}
G(c) = ⋃ { g + 1 : g ∈ G(p) }   over every descent edge p → c with p reachable from F
       replaced by { override(c) } when c has a valid override
```

Implementation (`backend/src/modules/generations/generation-engine.ts`), O(V + E):

1. Load the family's descent edges (projection `personA, personB`) and build `children[p]` adjacency.
2. Breadth-first search from `F` to find the reachable set `R`.
3. Compute in-degree restricted to edges inside `R`, then **Kahn's topological order** starting from `F`. If some node in `R` is never emitted, a cycle exists → abort, flag the involved nodes, raise a data-integrity alert (should be impossible).
4. Walk in topological order, computing candidate sets `G(c)` as above (stored as a sorted small set; in practice it is one value, occasionally two).
5. Classify every person in the family:

| Condition | `generation.status` | `generation.number` |
|---|---|---|
| person is F | `founder` | 1 |
| reachable, `|G| = 1` | `computed` | the value |
| reachable, `|G| > 1`, no override | `conflict` | **null**, `candidates = G` |
| reachable via descent edges only when *unverified* edges are also followed | `unverified_path` | null (candidate shown as "provisional") |
| not reachable, but has a partnership with someone reachable | `married_in` | null (rendered beside their partner) |
| otherwise | `unconnected` | null |

6. Diff against the stored values and `bulkWrite` **only changed** people; write a `generation_snapshots` document with per-generation totals (living / deceased / unknown, earliest and latest birth year) and update `families.stats`.
7. Create a review item for each new conflict.

Generation is **independent of age and birth year** — the engine never reads dates except for statistics.

### Why conflicts happen and how they resolve

Cousin marriage across generations: Kofi (G1) → Kwame (G2) → Yaw (G3); Kofi → Ama (G2) → Abena (G3) → Kojo (G4). If Yaw and Kojo have a child, that child has candidates {4, 5}. The engine stores `conflict, candidates [4,5]` and the child's descendants inherit shifted candidate sets. An admin pins 4 (with a reason); the override is audited and everything below recomputes deterministically.

### Changing the founder

`family.set_founder` (admin only) sets `foundingMemberId` to any person — typically a newly discovered ancestor above the current founder — inside a transaction that writes an audit entry, then asks for a recalculation (bursts of edits to a large family are folded into one background run). Overrides are cleared when the founder changes because their meaning is relative to the old founder.

### When recalculation runs

After any committed change to: a descent edge (create / delete / subtype / verification), the founder, the adoptive policy, or an override. Families under 2 000 people are recalculated in the same request after commit; larger ones in the background of the same process, just after the response. The UI shows "Recalculating…" from the `pending` status on the family stats.

## 4.3 Relationship engine

Implemented in `backend/src/modules/kinship/kinship-engine.ts` (pure, 78 unit tests). The family's links are cached per family and invalidated by `families.graphRevision`, which every relationship change increments.

1. **Blood relationship** — run a bidirectional BFS over parent edges (biological by default; adoptive edges optionally, labelled "adoptive") collecting `ancestor → distance` maps for A and B. The **lowest common ancestors** are the common ancestors not themselves ancestors of another common ancestor. With `d1 = dist(A, LCA)`, `d2 = dist(B, LCA)`:

| d1, d2 | Relationship of A to B |
|---|---|
| 0, n | A is B's ancestor: parent (1), grandparent (2), great-grandparent (3), 2× great-grandparent (4)… |
| 1, 1 | siblings — **full** if they share two parents, otherwise **half** |
| 1, n≥2 | aunt/uncle (n=2), grand-aunt/uncle (3), great-grand-aunt/uncle (4)… |
| n≥2, 1 | niece/nephew, grand-niece/nephew… |
| m, n ≥ 2 | cousins: degree = min(m,n) − 1, removed = |m − n| ("second cousin once removed") |

Gender-specific words (father/mother, uncle/aunt) are used only when the gender is recorded; otherwise neutral words (parent, parent's sibling).

2. **Affinal relationships** — if no blood path exists: a direct partnership (husband / wife / partner, "former" when divorced or separated), a directly recorded step / foster / guardian link, then the shortest path through **exactly one** partnership: parent-, child-, sibling- and grandparent-in-law; uncle/aunt and nephew/niece by marriage; step-parent, step-child, step-sibling, step-grandparent; otherwise a plain description such as "first cousin once removed of Abena's husband". Chains through two or more marriages are not given a kinship name.

   Full vs half: compared on the two people just below the common ancestor. If either has a parent missing from the record, the result says it is not known rather than assuming "full".
3. **Explanation** — the engine returns the actual chain of people and edge labels, e.g. `Kwame → (father) Kofi → (son) Yaw → (daughter) Abena`, plus `confidence: 'verified' | 'includes_unverified' | 'incomplete'`. If no path exists within the recorded data the result is `{ kind: 'not_found', reason }` — the engine **never invents** a relationship.
