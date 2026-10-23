# Phase 12 — Richer archive: what was built and how it was verified

## Delivered

**Places** (Places in the menu)
- Towns and villages as records: name, region, country, optional coordinates, **other names and spellings**
  ("Kumase", "Coomassie") and notes. Administrators and editors (`event.manage`) record them; every member sees them.
- People's birthplaces, hometowns and places of death, and events' places, stay free text. A place matches when
  the text, or its part before the first comma, equals its name or another name — ignoring case, accents and
  punctuation ("Kumasi, Ashanti" and "KUMASE" both count for Kumasi).
- **Mentioned but not recorded yet**: names used on profiles and events that match no place, most used first;
  one click records one.
- Each place shows who was **born** there, who is **from** there, who **died** there, and the events held there.
- **Where the family moved**: *between generations* (a parent born in one place, their child in another, counted
  once per child) and *within a lifetime* (born in one place, lived or died in another), as a list and as lines
  on the map.
- **The map**: with a tile service configured (`MAP_TILE_URL`), a street map (Leaflet, downloaded only on the
  Places page); without, the places are drawn to scale on a plain background with the same lines. Places
  without coordinates are listed and marked "Not on the map yet". Coordinates are pasted as map apps copy them
  ("6.6885, -1.6244").
- Counts, lists and moves are built for each viewer from what they may see: a child's birthplace is withheld
  from members just as on the child's profile.

**People in photos** (the photo viewer)
- **Tag people**: drag a box around a face, choose who it is. Boxes are stored as fractions of the photo so they
  fit at any size; a tagged person is also added to the photo's people. "Show who is who" / "Hide names"
  toggles the boxes, and hovering a name in the list highlights the box.
- Tags follow the family record: a removed person's box disappears (and comes back if they are restored);
  boxes of people the editor cannot see are kept when they save; a **merge** moves the other person's boxes to
  the kept person (dropping the duplicate where both were tagged) and **undo** puts them back exactly.

**Transcripts** (recordings and videos, in the viewer)
- **Typed**: what is said, the language spoken, and an optional translation. Transcripts and translations are
  searched along with titles ("grandmother" finds a Twi recording through its English translation), and are
  private exactly as their recording.
- **Automatic** (optional): with `TRANSCRIPTION_URL` set to an OpenAI-compatible speech-to-text endpoint
  (OpenAI's Whisper, or a self-hosted server with the same API), "Transcribe automatically" and "…and translate
  to English" queue the recording on the worker (inline without Redis). The viewer shows progress and checks
  back; failures are shown to editors. A typed transcript is never overwritten — clear it first.
- Without a speech service, the automatic buttons do not appear and the API refuses politely.

**Also**
- `GET /api/v1/config` tells the web app whether maps and transcription are available.
- Change history labels for places, tags and transcripts.
- Deployment: `MAP_TILE_*` and `TRANSCRIPTION_*` settings in compose and the examples; the web container takes
  `MAP_TILE_ORIGINS` so the Content-Security-Policy allows the tiles.

## Verification

| Check | Result |
|---|---|
| Backend (unit + integration, real MongoDB) | **291 passing** — new: place-name matching; places end to end (counts, suggestions, both kinds of moves, detail lists, events); a child's birthplace withheld from members; names, other names, coordinates, versions and permissions; tags with box checks, people added to the photo, removed people's boxes hidden and kept; tags moved by a merge and restored by undo; typed transcripts and translations, search, refusal on photos and over a typed transcript; automatic transcription and translation with a stand-in speech service, failures, size limit, audit entries; `/config` with and without maps and transcription |
| Frontend unit / contracts | 32 / 23 passing (new: reading pasted coordinates) |
| End-to-end (Playwright) | **19 passing** — new journey: record two places from the suggestions (one with other names), see three moves on the map and in the list, filter to moves between generations, open a place and see who was born and died there; tag a person in a photo by drawing a box and hide the names; type a transcript with a translation and find the recording by a word in the translation. The phone-screen check includes the Places page. The street-map variant was also checked by hand (Leaflet with tooltips and clicks, no console errors) |

The Leaflet library (150 kB, 38 kB compressed) loads only on the Places page, so the initial download is
unchanged apart from the menu icon (681 kB, 114 kB compressed). Its stylesheet is vendored, trimmed to the parts
used (`features/places/leaflet.css`), which is why the per-component style warning moved from 4 kB to 7 kB.
