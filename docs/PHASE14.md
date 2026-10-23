# Phase 14 — Family book & languages: what was built and how it was verified

## Delivered

**Family book** (Family Book in the menu)
- A PDF to print or share. It can cover:
  - the **whole family**;
  - **a branch** (the founder's descendants and their partners);
  - **one person's family** (their ancestors and descendants, 1–10 generations each way, with partners).
- Contents:
  - a cover with the family name, title and generation bands;
  - a contents page;
  - the **family tree**: the first person and their children as a chart, then the whole line generation by
    generation, with partners;
  - **a page for each person**: photo, generation, born, died, hometown, parents, partners, children (linked to
    their pages), work, education, biography and their stories;
  - the **stories** in full;
  - a **timeline** of events, births and deaths;
  - **photographs** with captions;
  - an **index of names** with page numbers.
- Every page has a footer. Names inside the PDF link to the person's page.
- Options:
  - the title and subtitle;
  - which parts to include;
  - A4 or US Letter paper;
  - **living people by name only**. This is the default, and is recommended for books that will be printed and
    passed around.
- The book holds what its maker may see (the same privacy rules as the app). It is in the maker's language: the
  app sends the printed words translated, and dates follow the language.
- Fonts (Noto Serif and Noto Sans) cover Twi, Ga, Ewe and Hausa letters (ɛ ɔ ŋ ɖ ƒ ɣ ʋ ɓ ɗ ƙ ƴ).
- Books are made by the worker. Progress shows in the app.
  - Each person sees and downloads only their own books, through short-lived signed links.
  - One book is made at a time per person, and the latest ten are kept.
  - Making a book is recorded in the change history.

**Languages** (Settings → Language, and on the sign-in pages)
- The whole interface is translatable:
  - every text in every screen, dialog, menu and page title;
  - the API's fixed error messages;
  - labels shared with the API;
  - dates and numbers in the chosen language.
- Languages:
  - **English** (the source);
  - **French**;
  - **drafts** in **Twi, Ga, Ewe and Hausa**. These were made without native speakers; the app says so, and they
    wait for review.
- The language follows the person from device to device: it is saved to the account and remembered on each device.
  Before signing in, the browser's language is used.
- How it works:
  - English texts are the keys of the catalogs (`public/i18n/<code>.json`), with `{placeholders}` and ICU plurals.
  - `npm run i18n:lint` finds unmarked text in templates.
  - `npm run i18n:extract` collects every text (1,946).
  - `npm run i18n:check` fails on any missing text or mismatched placeholder.
  - All three run in CI. See [I18N.md](I18N.md).

## Verification

| Check | Result |
|---|---|
| Backend (unit + integration, real MongoDB) | **316 passing**. New tests cover:<br>• Book dates in English and French, and fallback labels<br>• A whole-family book with a profile photo, a story and an event, made, listed and downloaded as a PDF<br>• Living people by name only, or in full<br>• Branch and person books (who is in them, where the tree starts, titles)<br>• Books kept to their maker; checked requests; one at a time; removal<br>• Failures recorded<br>• **A 500-person, six-generation family: data gathered and over 500 pages laid out in a few seconds** |
| Frontend unit / contracts | 32 / 23 passing |
| Translations | All five catalogs complete: 1,946/1,946 texts, placeholders and plurals checked. The lint finds no unmarked template text |
| End-to-end (Playwright) | **23 passing**: every earlier journey still passes with the marked screens, so the English is unchanged. New journeys:<br>• Make a family book and download the PDF<br>• Switch the interface to French; it comes back in French on a fresh device after signing in; switch back to English<br>The phone-screen check includes the book page |

The texts of the draft languages should be reviewed by native speakers before relying on them. Each catalog is one
JSON file that reviewers can edit directly, and `npm run i18n:check` checks it. Where to start:

- **Key terms**, which repeat everywhere and were partly coined:
  - Twi: *ɔhwɛfo* (administrator), *ɔhwɛhwɛmufo* (moderator), *sika kotokuo* (fund), *dubaa* (branch), *awo ntoatoasoɔ* (generation).
  - Ga: *nɔkwɛlɔ* (administrator), *nine* (branch), *adesã* (stories; maybe *sane*).
  - Ewe: *dzikpɔla* (administrator), *nuŋlɔɖi* (used for both profile and record), *hlɔ̃* (line; it means clan).
  - Hausa: *mai gudanarwa* (administrator), *bayanin martaba* (profile), *aukuwa* (event).
- **Twi "abusua"** is used both for "family" in general and for the matrilineal abusua. The lineage screens may need a
  different word for one of them.
- **Hausa** mostly uses masculine forms as a neutral default, notably in the change history and "{name} died".
- **Sentence fragments** around links or bold names ("Told by", ", then", "or", "Signed in as", "Will be added as a
  child of") should be read in the running app, because the word order may not join up.
- **Month abbreviations** in the drafts are made up; there is no standard set. Greetings in Ga are guesses.
- **Technical words** often stay in English inside the sentences (password, e-mail, link, QR code, PDF). Reviewers can
  decide which to translate.
