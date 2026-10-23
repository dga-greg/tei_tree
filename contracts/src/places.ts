import type { EventKind } from './archive.js';
import type { FuzzyDate } from './dates.js';
import type { PersonCard } from './members.js';

/**
 * Places as records: a town, village or city the family knows, with optional coordinates. People's birth,
 * death and hometown fields and events' places are free text; a place is matched to them by its name or one of
 * its other names (the text before the first comma also counts, so "Kumasi, Ashanti" matches "Kumasi").
 */
export interface PlaceView {
  id: string;
  name: string;
  region: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  /** Other spellings and names ("Coomassie" for Kumasi). */
  aliases: string[];
  notes: string;
  /** People the viewer may see: born, died, from (hometown) here; events held here. */
  counts: { births: number; deaths: number; hometowns: number; events: number };
  viewerCan: { edit: boolean };
  version: number;
}

export interface PlaceInput {
  name: string;
  region?: string;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  aliases?: string[];
  notes?: string;
}
export type UpdatePlaceRequest = Partial<PlaceInput> & { version: number };

/**
 * A movement between two places: `generation` — a parent born in one place, a child in the other;
 * `lifetime` — born in one place, died or made a home in the other.
 */
export interface PlaceFlow {
  kind: 'generation' | 'lifetime';
  from: { id: string; name: string };
  to: { id: string; name: string };
  people: number;
}

export interface PlacesOverview {
  places: PlaceView[];
  flows: PlaceFlow[];
  /** Place names used on people and events that are not places yet, most used first. */
  suggestions: { name: string; uses: number }[];
}

export interface PlaceDetail {
  place: PlaceView;
  born: PersonCard[];
  died: PersonCard[];
  hometown: PersonCard[];
  events: { id: string; title: string; kind: EventKind; date: FuzzyDate | null }[];
}

/** Map tiles, when the server is set up with a tile service; otherwise the app draws places without a base map. */
export interface PublicConfig {
  mapTiles: { url: string; attribution: string; maxZoom: number } | null;
  /** Whether recordings can be transcribed automatically. */
  transcription: boolean;
  /** Whether "Continue with Google" is offered. */
  google: boolean;
}
