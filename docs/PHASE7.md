# Phase 7 — Archive: what was built and how it was verified

## Delivered

**Photos, documents, recordings and videos** (`backend/src/modules/media`, `backend/src/infra/storage.ts`)
- **Upload pipeline**: the multipart body streams to a private temporary file while it is hashed (SHA-256); the size limit (`MEDIA_MAX_UPLOAD_MB`, default 50) is enforced while streaming, so an oversized upload is cut off rather than stored.
- **Typed by content**: magic bytes decide what a file is; the file name and the browser's MIME type are ignored. Accepted: JPEG, PNG, WebP, GIF, TIFF, PDF, MP3/M4A/WAV/OGG/FLAC, MP4/WebM/QuickTime. HTML disguised as a photo, SVG (which can carry scripts) and executables are refused (415).
- **Photos are re-encoded** with sharp: rotated to their EXIF orientation, then decoded and written afresh, which drops EXIF (including GPS location), XMP and trailing data; longest side capped at 4 096 px; a WebP thumbnail is made. Decompression bombs are refused (pixel limit).
- **Duplicates** (same SHA-256 in the family) are refused with the title of the existing copy.
- **Storage** behind a `StorageProvider`: `local` (development and tests) or `s3` (any S3-compatible store; required in production). Buckets and directories are never public.
- **Delivery**: every file request (`…/media/:id/content`) re-checks permission and redirects to a link valid for 5 minutes — an S3 presigned URL, or a local HMAC-signed token that carries the key, type and expiry (altered or expired links → 404; `Range` supported for seeking in recordings). Responses carry `nosniff`, a sandboxing CSP and `Content-Disposition`.
- **Metadata**: title, description, fuzzy date, people in it, event, provenance (source, citation, who holds the original), privacy (`family`, `admins`, `public`). Search by title/description, filter by kind, person and event.
- **Profile photos**: any published photo can become a person's profile picture (also from one's own claimed profile); it is dropped automatically when the photo is removed or restricted to administrators.
  - *Later addition:* the add/edit person form and the camera button on a person's photo pick a picture, crop it to a
    square (move, zoom, turn) and upload it as the profile photo in one step. It is kept in Photos & Documents, tagged
    with the person. Members' photos wait for a moderator and are set when approved.

**Stories and oral histories** (`backend/src/modules/stories`) — stories, oral histories (with an attached audio/video recording and its transcript), traditions and memories; narrator, date, place, people, attached files, sources and privacy. Authors may edit their own stories.

**Events and the family timeline** (`backend/src/modules/events`) — administrators and moderators record events (reunions, migrations, ceremonies, historical events…) with people and photos. The timeline combines recorded events, dated stories, and **births, deaths and marriages derived from the family record**. Derived lines follow the profile privacy rules: people hidden from the viewer are left out, names-only profiles add nothing, and children's or opted-out dates show as a year only.

**Review** — uploads and stories by members wait unpublished as `media.attach` / `story.create` suggestions in the existing review queue (with a thumbnail or excerpt). Approval publishes, declining hides it from everyone but the author, withdrawing removes it. Families can switch member uploads off (`privacy.allowMemberUploads`).

**Privacy** — members see family and public items plus their own additions; `admins` items only administrators and moderators; guests of public families only published public items that are not about anyone hidden from guests.

**Frontend**
- **Photos & documents** page: gallery with kind tabs, search and person filter; multi-file upload dialog (drag and drop, shared details, per-file status); viewer with photo / audio / video / PDF preview, previous/next, details, edit, remove, download and "use as profile photo".
- **Family history** page: decade-grouped timeline (filter by events, stories, records and by person; jump to decade), and a stories list; event dialog (view, record, edit, attach photos); story reader with recording player; story editor with attachments and recording selection.
- **Profiles** show the person's photos and documents (add from there), their stories, and a link to their timeline; avatars fall back to initials when a photo cannot be shown.
- The review queue previews uploads and stories. Navigation and dashboard quick actions for the archive are live.

## Verification

| Check | Result |
|---|---|
| Archive integration tests (real MongoDB, local storage): EXIF/GPS removed from served photos, WebP thumbnails, download disposition, byte ranges; forged and expired links refused; HTML-as-JPEG, SVG and an executable refused, PDF and MP3 typed by content, a truncated JPEG refused; duplicates, empty uploads, non-multipart requests and bad fields refused; size limit (413); privacy for members, administrators, guests and outsiders of private families; uploader/admin edit, version conflicts, search, removal stops new links, audit trail; member uploads through review (approve, decline, withdraw), uploads switched off; profile photos; stories and oral histories (recording type check, review, author editing, guest visibility); events and timeline (ordering, restricted people left out, child's birthday reduced to a year, person and decade filters, guest view, event files) | 12 passing |
| The tests were checked against two deliberate regressions (keeping EXIF; dropping the guest filter): both were caught | — |
| Backend total / frontend unit tests / contracts | **230** / 28 / 23 passing |
| Playwright against the live API | four files uploaded at once with shared details → gallery → viewer: edit, date, set as Kofi's profile photo; the photo served to the browser has no EXIF → event recorded with a photo → decade timeline (births, marriage, migration, deaths) → oral history written with a WAV recording that plays (2 s) → member's duplicate upload refused, new upload held for review → reviewer sees the thumbnail and approves → profile shows photo, files and stories → phone layouts. No console errors. |

## Known limitations (planned for Phase 8)

- Removing a file or story is a soft delete: the record disappears and no new links are issued, but the stored object is kept; there is no purge job or restore screen for files yet.
- Audio, video and PDF files are type-checked but stored as uploaded (no transcoding, duration extraction, PDF sanitising or virus scanning).
- Upload progress shows as an indeterminate bar: the app's fetch-based HTTP client does not report upload progress.
- With S3 storage, the SPA's Content-Security-Policy must allow the storage origin in `img-src` and `media-src`.
