import type { BirthEraKey } from './eras.js';
/** The printable family book: a PDF made on the server from what the person asking may see. */
export const BOOK_SCOPES = ['family', 'branch', 'person'] as const;
export type BookScope = (typeof BOOK_SCOPES)[number];
export const BOOK_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];
export const PAPER_SIZES = ['A4', 'LETTER'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

/**
 * Words printed in the book, in English. The app sends them translated (`labels`), so the book comes out in the
 * language of the person who asks for it. `{…}` are placeholders.
 */
export const BOOK_LABELS = {
  contents: 'Contents',
  familyTree: 'Family tree',
  people: 'People',
  stories: 'Stories',
  timeline: 'Timeline',
  photos: 'Photographs',
  index: 'Index of names',
  descendantsOf: 'The descendants of {name}',
  familyOf: 'The family of {name}',
  madeOn: 'Made on {date}',
  born: 'Born',
  died: 'Died',
  hometown: 'Hometown',
  parents: 'Parents',
  partners: 'Partners',
  children: 'Children',
  work: 'Work',
  education: 'Education',
  generation: 'Generation {number}',
  livingNote: 'Details of living people are left out of this book.',
  toldBy: 'Told by {name}',
  page: 'Page {number}',
  bornEvent: '{name} was born',
  diedEvent: '{name} died',
  about: 'about {date}',
  estimated: 'est. {date}',
  before: 'before {date}',
  after: 'after {date}',
  between: 'between {date} and {end}',
  from: 'from {date}',
  married: 'm.',
  moreChildren: '{count} more in the next generations',
  noDetails: 'Nothing more is recorded yet.',
  // Eras of birth, as on a person's tag in the app (BIRTH_ERA_LABELS).
  eraLost: 'Lost Generation',
  eraGreatest: 'Greatest Generation',
  eraSilent: 'Silent Generation',
  eraBoomers: 'Baby Boomer',
  eraGenx: 'Gen X',
  eraMillennials: 'Millennial',
  eraGenz: 'Gen Z',
  eraAlpha: 'Gen Alpha',
  eraBeta: 'Gen Beta',
} as const;
export type BookLabelKey = keyof typeof BOOK_LABELS;
export type BookLabels = Record<BookLabelKey, string>;

/** The book label naming each era of birth. */
export const BOOK_ERA_LABEL: Record<BirthEraKey, BookLabelKey> = {
  lost: 'eraLost',
  greatest: 'eraGreatest',
  silent: 'eraSilent',
  boomers: 'eraBoomers',
  genx: 'eraGenx',
  millennials: 'eraMillennials',
  genz: 'eraGenz',
  alpha: 'eraAlpha',
  beta: 'eraBeta',
};

export interface BookOptions {
  scope: BookScope;
  /** For a branch book. */
  branchId?: string | null;
  /** For a person's book: the person, with their ancestors and descendants. */
  personId?: string | null;
  /** How many generations up and down from the person (person books). */
  generations?: number;
  title?: string;
  subtitle?: string;
  include: { tree: boolean; people: boolean; stories: boolean; timeline: boolean; photos: boolean };
  /** `names`: living people appear by name only, for books that will be printed and passed around. */
  living: 'names' | 'full';
  paper: PaperSize;
  /** Language of the book: BCP 47 code for dates, and the labels translated. */
  locale?: string;
  labels?: Partial<BookLabels>;
}

export interface BookView {
  id: string;
  title: string;
  options: BookOptions;
  status: BookStatus;
  /** 0–100 while it is being made. */
  progress: number;
  pages: number | null;
  people: number | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** API path that redirects to the file (signed, short-lived). */
  downloadUrl: string | null;
}
