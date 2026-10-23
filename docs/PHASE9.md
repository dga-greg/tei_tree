# Phase 9 — Bringing data in & keeping it clean: what was built and how it was verified

## Delivered

**GEDCOM import** (Import & Duplicates in the menu; family administrators)
- Reads GEDCOM **5.5, 5.5.1 and 7.0** files as written by Ancestry, MyHeritage, FamilySearch, Gramps, Family
  Tree Maker and others, in **UTF-8** (with or without a byte-order mark), **UTF-16**, **ANSEL** (accents written
  before the letter), **Windows-1252** and **Mac Roman**. Up to 30 MB and 20 000 people per import.
- People: names (given, surname with prefixes, title, nickname, birth/maiden name, married and other names),
  sex, birth (or baptism, as an approximate date), death (or burial/cremation), occupations, education,
  nationality, notes (inline and shared NOTE records, with CONT/CONC) and sources (with page citations).
- Dates: exact and partial dates, `ABT`/`CAL`/`EST`/`BEF`/`AFT`, `BET … AND …`, `FROM … TO …`, interpreted
  dates, dual years (1731/32), ISO dates; anything else (other calendars, BC dates, phrases) is kept as the
  date's wording rather than lost.
- Families: couples (marriage, customary marriage, civil union, partnership, engagement; divorced, annulled,
  separated) and children, with the kind of parent link from `FAMC.PEDI` or the `_FREL`/`_MREL` tags some
  programs write; children recorded only on the child's side (`FAMC`) are found too.
- Life status: a death or burial means deceased; with no death, people born in the last 100 years are treated
  as living so the family's privacy rules protect them, and people born over 120 years ago as deceased.
- **Preview first**: counts, the program and version that wrote the file, the first 100 people, warnings in
  plain language, and **people who may already be in the family** with the reasons ("Same first name", "Born the
  same year", …). Likely matches start as "Same person"; possible ones as "Different".
- **Import in one transaction**, applying the family's integrity rules to the file and the family together: a
  third birth parent is recorded as an "unknown" parent link, links that would make someone their own ancestor
  are skipped, a couple who are also parent and child keeps only the parent link, links the family already has
  are not repeated. Each change is reported as a warning.
- Matched people are not added twice; their links from the file join them, and (optionally) their **empty**
  details are filled in from the file. Links from the file count as checked by default (generations follow
  checked links only); this can be switched off to review them one by one.
- **Undo an import**: removes everyone and every link it added (people can then be brought back individually
  from removed people) and puts back details it filled in, unless they were changed since. Refused, with the
  reason, while an imported person is the founder, claimed by an account, or starts a branch.

**Duplicates and merging** (administrators)
- The duplicate finder compares people whose first names sound alike (the phonetic keys already used by
  search) and scores names, surnames (including maiden and earlier names), dates of birth and death, gender, life
  status and shared parents. People already linked to each other are never suggested; pairs marked "Not the same
  person" are not suggested again.
- **Merge** from the duplicates list, or from any profile ("Merge"): a side-by-side comparison where each
  differing detail is chosen from either record (empty details default to the other record's value). Education,
  work, achievements, sources and names are combined; the name not kept is remembered as an earlier name; the
  stricter privacy setting applies.
- Everything pointing at the merged person moves to the kept one: parents, children and partners (links both
  had are kept once, a link between the two is removed), tags on photos, stories and events, a claimed account,
  the founder, branches, pending invitations and open suggestions. A merge that would give someone more than two
  birth parents, make anyone their own ancestor, or make two people both partners and parent and child is
  refused with an explanation, and nothing changes.
- **Undo a merge** ("Separate again") restores both records exactly, while the kept person has not been
  changed since. A merged person does not appear among removed people; the merge is undone instead.

**Also in this phase**
- The development server reads the shared `@fh/contracts` package fresh instead of from Vite's dependency
  cache. A stale cached copy left the page blank after `git pull` when the shared package had changed.
- The profile header lets its actions wrap below the name instead of squeezing the name out of view when there
  are many actions (found by the end-to-end suite).
- The initial-bundle size warning moved from 600 kB to 650 kB: the icon library is one module, so every icon
  used anywhere lands in the first download (about 2 kB each uncompressed, compressing very well; the initial
  download is 107 kB compressed).
- Second roadmap, phases 9–14, in [07-ROADMAP.md](07-ROADMAP.md).

## Verification

| Check | Result |
|---|---|
| Backend (unit + integration, real MongoDB) | **264 passing** — new: GEDCOM dates (exact, partial, qualified, ranges, dual years, other calendars), character sets (ANSEL, UTF-16, BOM, Windows-1252), Ancestry-style and Gramps/FamilySearch-style files, warnings, the import plan's integrity rules, match scoring, **round trip** (export a family, import it into another: same people and links), fill-in and undo, permissions and file checks, duplicate finding and dismissal, merge with links, tags and claims and its undo, merges refused by the rules |
| Frontend unit / contracts | 28 / 23 passing |
| End-to-end (Playwright) | **16 passing** — new journey: import a MyHeritage-style file, check the matches, import, see a filled-in birthplace, merge the duplicate the import brought, separate again, undo the import. The phone-screen check now includes the import, duplicates and merge pages |
