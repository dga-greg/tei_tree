# Family IDs and member details

This build is a family register kept by the family's administrators. It has four menus: **Dashboard**, **Family Tree**, **Family Members** and **Settings**. Only administrators sign in; there are no invitations, suggestions or messages.

## What is recorded for each person

| Field | Notes |
|---|---|
| Family ID | Given automatically (below); never typed in |
| Name | First name and surname |
| Common name | What people call them, e.g. *Papa Nii* |
| Gender | Male, female, other or not recorded |
| Place of stay | Where they live now |
| Date of birth | Can be partial: a year, a month and year, "about 1920", "before 1930" |
| Status | Living, deceased or unknown. Choosing **deceased** asks for the date of death (also partial) |
| Picture | Cropped on upload; shown on the profile, in the list and in the tree |
| Other details | Any number of name/value pairs, added at any time (e.g. *Occupation: Teacher*). Names already used in the family are suggested, so they stay spelt the same |

## How family IDs are given

- The **family head** is **G1**.
- A child takes the ID of the parent who is in the family line, plus their number among that parent's children: **G1.1, G1.2, G1.3**, then **G1.2.1** and so on. When both parents are in the line, the father's ID is used.
- A **husband or wife** who married in gets their partner's ID with **-W** (wife), **-H** (husband) or **-S** (spouse, when gender is not recorded) and a number: **G1.2-W1**, **G1.2-W2**.
- IDs are **stable**: once given, an ID never changes and is never given to anyone else, even if the person is removed. A child found later gets the next free number (if G1.1–G1.3 exist, the new child is G1.4, whatever their birth order).
- A person is given an ID as soon as they are linked to someone who has one. People not linked yet show **No ID yet**.

### A new, earlier family head

If the family later finds that the recorded head was not the first, add the real head and choose them in **Settings → Family → Family head**. The new head becomes **G0** (and an even earlier one **G-1**). Nobody else's ID changes, so the tree and every written record stay valid.

## Finding people

The Family Members search takes a name or an ID. Searching for an ID (e.g. `G1.2`) lists that person and everyone below them, in ID order. The list is sorted by family ID by default.

## Where it lives in the code

- `backend/src/modules/members/family-code.ts` — `assignFamilyCodes()`, run on every change to the family graph (from the generation scheduler); it only fills in missing IDs, never rewrites one.
- `backend/src/modules/members/member.model.ts` — `familyCode` (unique per family), `residence`, `attributes`.
- `backend/test/family-codes.test.ts` — the rules above as tests.
- `frontend/src/app/shared/ui/family-code.component.ts` — the ID badge.
