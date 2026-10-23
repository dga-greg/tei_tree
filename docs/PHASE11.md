# Phase 11 — Lineage & family life: what was built and how it was verified

## Delivered

**Lineage** (Lineage in the menu; on every profile; in the tree)
- Each person can have a **line through the mother** (the Akan *abusua*), a **line through the father** (the
  *ntoro*, or the clan in patrilineal Ga and Ewe families) and a **totem**. The family chooses what the lines are
  called, which it uses, which line the totem follows, and whether adoptive parents pass lines on.
- A line is recorded once, on the earliest ancestor known; everyone descended through the right parent
  **inherits** it (a mother is a parent recorded as female, a father one recorded as male; birth parents are
  preferred, disputed links never pass anything on). A value recorded on someone that differs from what their
  parent passes on is kept and flagged ("Their parent's line is Oyoko").
- Profiles show each line and where it comes from ("From Akosua Owusu"). The **Lineage page** lists every line
  with its people, living count, totem and the people it is recorded on. The **tree can be coloured by line**
  (Okabe–Ito colours, readable with colour blindness, with a legend and the line in each card's screen-reader
  label).
- Lines are worked out when read (never stored twice), cached per family until people, links or the settings change.

**Ceremonies** (Ceremonies in the menu)
- Naming ceremony (outdooring), engagement (knocking), wedding, funeral, one-week observance, memorial and
  thanksgiving, alongside the existing tradition kind. They are family events, so they also appear on the
  family timeline and in the calendar.
- Each has the people it is for, an **order of events** (time, what happens, who leads, details — with typical
  programmes to start from for naming ceremonies, engagements, weddings and funerals), **roles** held by people in
  the tree or by named guests (chief mourner, okyeame, MC, officiating minister…), photos, and a linked fund
  with its total and progress.

**Family funds** (Family Funds in the menu)
- Funds for **dues**, a **ceremony**, a **project**, **welfare** or anything else, in any currency (GHS by
  default), with an optional target. Amounts are kept as whole pesewas (minor units), so totals add up exactly.
- Contributions from people in the tree or named contributors (a church group, colleagues), with date,
  method (cash, mobile money, bank, cheque), reference and note; corrections and removals are audited.
- **Dues**: amount, monthly/yearly/once, and who pays; the Dues tab shows, for any month or year, what each person
  owes, has paid and still owes.
- Totals **by branch** (a person in two branches counts in both, and the page says so) and **by month**; **CSV
  download** for spreadsheets (amounts in the currency, names that look like formulas neutralised).
- **Who sees what**, per fund: only administrators and treasurers; members see the fund and its totals; or members
  also see who gave what. Everyone always sees their own contributions ("Your contributions").
- **Treasurers**: any member can be made treasurer in Members & Roles; they keep the accounts whatever their role.
- Safeguards: a closed fund takes no more contributions; a fund's currency cannot change once money is recorded;
  unknown currencies are refused.

## Verification

| Check | Result |
|---|---|
| Backend (unit + integration, real MongoDB) | **281 passing** — new: the lineage engine (maternal and paternal inheritance, men not passing the maternal line, recorded values that differ, adoption on and off, settings, disputed links); lineage on profiles, the overview and tree nodes, settings and their permissions; a funeral with programme, roles and fund, the ceremonies list and the calendar; funds end to end — permissions, treasurers, contributions and validation, dues per payer for a month, totals by month and branch, CSV with formula neutralisation, what members see, funds hidden from members, currency and closed-fund rules, audit entries |
| Frontend unit / contracts | 30 / 23 passing (new: typed amounts to minor units and back, including currencies without decimals) |
| End-to-end (Playwright) | **18 passing** — new journey: record an abusua and totem on one profile, see them inherited two generations down (and not through a son), on the Lineage page and in the coloured tree; plan a naming ceremony from the typical programme with a named godmother; create monthly dues and record a contribution. The phone-screen check includes the lineage, ceremonies and funds pages |

The initial-download size warning moved to 700 kB (657 kB now, 112 kB compressed) because the new menu icons
join the icon library's single module; see PHASE9.md.
