import type { FuzzyDate } from './dates.js';
import type { PersonCard, SourceReference } from './members.js';

/** Who may see an archive item: all family members, only administrators and moderators, or (in public families) anyone. */
export const ARCHIVE_PRIVACY = ['family', 'admins', 'public'] as const;
export type ArchivePrivacy = (typeof ARCHIVE_PRIVACY)[number];
export const ARCHIVE_PRIVACY_LABELS: Record<ArchivePrivacy, string> = {
  family: 'Family members',
  admins: 'Administrators and moderators only',
  public: 'Public (if the family is public)',
};

/** Review state of items added by people whose additions are checked first. */
export const ARCHIVE_STATUSES = ['pending_approval', 'published', 'rejected'] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

// ---------------------------------------------------------------- media

export const MEDIA_KINDS = ['photo', 'document', 'audio', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_KIND_LABELS: Record<MediaKind, string> = { photo: 'Photo', document: 'Document', audio: 'Recording', video: 'Video' };

/**
 * Accepted file types. The server decides the type from the file's content (magic bytes), never from
 * its name or the browser's claim. Images are re-encoded, which removes location and camera metadata.
 */
export const MEDIA_ACCEPT: Record<MediaKind, readonly string[]> = {
  photo: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff'],
  document: ['application/pdf'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/x-flac', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
};
export const MEDIA_MAX_BYTES_DEFAULT = 50 * 1024 * 1024;

export interface MediaProvenance {
  /** Where it came from: "Auntie Ama's album", "National Archives". */
  source: string;
  citation: string;
  /** Who holds the original. */
  originalHolder: string;
}

/** A person shown in a photo: a box in fractions of the photo's width and height (0–1). */
export interface PhotoBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PhotoTag {
  /** Null when the person is hidden from the viewer. */
  person: PersonCard | null;
  box: PhotoBox;
}
export interface PhotoTagInput {
  memberId: string;
  box: PhotoBox;
}

export const TRANSCRIPT_STATUSES = ['none', 'pending', 'done', 'failed'] as const;
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

/** What is said in a recording or video, typed by someone or produced by a speech-to-text service. */
export interface MediaTranscript {
  status: TranscriptStatus;
  text: string;
  /** Language of the recording, e.g. "Twi", "English" (free text). */
  language: string;
  source: 'typed' | 'automatic' | null;
  /** Optional translation, e.g. into English. */
  translation: { text: string; language: string } | null;
  /** Why automatic transcription failed. */
  error: string | null;
  updatedAt: string | null;
}

export interface TranscriptInput {
  text: string;
  language?: string;
  translation?: { text: string; language: string } | null;
  version: number;
}

export interface MediaView {
  id: string;
  kind: MediaKind;
  title: string;
  description: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  date: FuzzyDate | null;
  privacy: ArchivePrivacy;
  provenance: MediaProvenance;
  status: ArchiveStatus;
  people: PersonCard[];
  eventId: string | null;
  uploadedBy: { id: string; displayName: string } | null;
  createdAt: string;
  /** Same-origin URLs that check permission and redirect to a short-lived signed file URL. */
  urls: { original: string; thumb: string | null; download: string };
  viewerCan: { edit: boolean; delete: boolean; setAsProfilePhoto: boolean };
  /** People tagged in a photo. */
  tags: PhotoTag[];
  /** Recordings and videos only. */
  transcript: MediaTranscript | null;
  version: number;
}

/** Sent as multipart form fields before the `file` part. JSON-encoded fields: date, memberIds, provenance. */
export interface UploadMediaFields {
  title?: string;
  description?: string;
  date?: FuzzyDate | null;
  memberIds?: string[];
  eventId?: string | null;
  privacy?: ArchivePrivacy;
  provenance?: Partial<MediaProvenance>;
  /** Makes the photo this person's profile photo (after review, for uploads that are reviewed). */
  profileOf?: string;
}

export interface UpdateMediaRequest {
  version: number;
  title?: string;
  description?: string;
  date?: FuzzyDate | null;
  memberIds?: string[];
  eventId?: string | null;
  privacy?: ArchivePrivacy;
  provenance?: Partial<MediaProvenance>;
}

export interface MediaListQuery {
  kind?: MediaKind;
  memberId?: string;
  eventId?: string;
  q?: string;
  status?: ArchiveStatus;
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------- stories

export const STORY_KINDS = ['story', 'oral_history', 'tradition', 'memory'] as const;
export type StoryKind = (typeof STORY_KINDS)[number];
export const STORY_KIND_LABELS: Record<StoryKind, string> = {
  story: 'Story',
  oral_history: 'Oral history',
  tradition: 'Tradition',
  memory: 'Memory',
};

export interface StoryView {
  id: string;
  kind: StoryKind;
  title: string;
  /** Plain text; paragraphs separated by blank lines. For oral histories, the transcript. */
  body: string;
  /** Who told or wrote it. */
  narrator: string;
  /** When it was recorded or happened. */
  date: FuzzyDate | null;
  place: string;
  people: PersonCard[];
  eventId: string | null;
  /** Photos, documents and the recording attached to the story, as far as the viewer may see them. */
  media: MediaView[];
  /** For oral histories: the recording. */
  recording: MediaView | null;
  sources: SourceReference[];
  privacy: ArchivePrivacy;
  status: ArchiveStatus;
  createdBy: { id: string; displayName: string } | null;
  createdAt: string;
  updatedAt: string;
  viewerCan: { edit: boolean; delete: boolean };
  version: number;
}

export interface StoryInput {
  kind: StoryKind;
  title: string;
  body: string;
  narrator?: string;
  date?: FuzzyDate | null;
  place?: string;
  memberIds?: string[];
  eventId?: string | null;
  mediaIds?: string[];
  recordingMediaId?: string | null;
  sources?: SourceReference[];
  privacy?: ArchivePrivacy;
}
export type UpdateStoryRequest = Partial<StoryInput> & { version: number };

// ---------------------------------------------------------------- events & timeline

export const EVENT_KINDS = [
  'birth',
  'death',
  'marriage',
  'reunion',
  'migration',
  'tradition',
  'historical',
  'other',
  'naming',
  'engagement',
  'wedding',
  'funeral',
  'one_week',
  'memorial',
  'thanksgiving',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  birth: 'Birth',
  death: 'Death',
  marriage: 'Marriage',
  reunion: 'Reunion',
  migration: 'Migration',
  tradition: 'Tradition / ceremony',
  historical: 'Historical event',
  other: 'Other',
  naming: 'Naming ceremony (outdooring)',
  engagement: 'Engagement (knocking)',
  wedding: 'Wedding',
  funeral: 'Funeral',
  one_week: 'One-week observance',
  memorial: 'Memorial / anniversary',
  thanksgiving: 'Thanksgiving service',
};

/** Event kinds shown as ceremonies, with a programme and roles. */
export const CEREMONY_KINDS = ['naming', 'engagement', 'wedding', 'funeral', 'one_week', 'memorial', 'thanksgiving', 'tradition'] as const satisfies readonly EventKind[];
export type CeremonyKind = (typeof CEREMONY_KINDS)[number];
export const isCeremony = (kind: EventKind): kind is CeremonyKind => (CEREMONY_KINDS as readonly string[]).includes(kind);

/** One line of a ceremony's order of events. */
export interface ProgrammeItem {
  /** Free text, e.g. "6:00", "Morning" or "After the burial". */
  time: string;
  title: string;
  detail?: string;
  /** Who leads it (a name, e.g. "Rev. Asare" or "Family spokesperson"). */
  lead?: string;
}

/** A role at a ceremony, held by someone in the tree or by a named person. */
export interface CeremonyRole {
  role: string;
  person: PersonCard | null;
  name: string;
}

export interface CeremonyRoleInput {
  role: string;
  memberId?: string | null;
  name?: string;
}

export interface EventView {
  id: string;
  kind: EventKind;
  title: string;
  description: string;
  date: FuzzyDate | null;
  place: string;
  people: PersonCard[];
  media: MediaView[];
  sources: SourceReference[];
  privacy: ArchivePrivacy;
  programme: ProgrammeItem[];
  roles: CeremonyRole[];
  /** The family fund collecting contributions for it, when there is one the viewer may see. */
  fund: { id: string; name: string } | null;
  createdAt: string;
  /** `announce`: may message relatives about it (administrators, moderators and the ceremony's role holders). */
  viewerCan: { edit: boolean; delete: boolean; announce: boolean };
  version: number;
}

export interface EventInput {
  kind: EventKind;
  title: string;
  description?: string;
  date?: FuzzyDate | null;
  place?: string;
  memberIds?: string[];
  mediaIds?: string[];
  sources?: SourceReference[];
  privacy?: ArchivePrivacy;
  programme?: ProgrammeItem[];
  roles?: CeremonyRoleInput[];
  fundId?: string | null;
}
export type UpdateEventRequest = Partial<EventInput> & { version: number };

/**
 * One line of the family timeline. Recorded events and stories appear as themselves; births, deaths and
 * marriages are derived from people's records (with the same privacy rules as their profiles).
 */
export interface TimelineItem {
  /** `event:<id>`, `story:<id>`, `birth:<memberId>`, `death:<memberId>`, `marriage:<relationshipId>`. */
  key: string;
  source: 'event' | 'story' | 'record';
  kind: EventKind | StoryKind;
  title: string;
  date: FuzzyDate;
  place: string;
  people: PersonCard[];
  eventId: string | null;
  storyId: string | null;
  /** Thumbnail URL of the first photo, if any. */
  thumbUrl: string | null;
}

export interface TimelineQuery {
  memberId?: string;
  from?: number;
  to?: number;
  include?: ('events' | 'stories' | 'records')[];
}
