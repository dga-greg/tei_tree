import { Types } from 'mongoose';
import sharp from 'sharp';
import { BOOK_ERA_LABEL, BOOK_LABELS, birthEraOf, type BookLabels, type BookOptions, type FuzzyDate } from '@fh/contracts';
import type { StorageProvider } from '../../infra/storage.js';
import { archiveVisibility } from '../archive/archive.shared.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import { FamilyEventModel } from '../events/event.model.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMediaModel } from '../media/media.model.js';
import { toFuzzyDate, toPersonCard } from '../members/member.mapper.js';
import { FamilyMemberModel, type FamilyMemberDoc } from '../members/member.model.js';
import { MemberPolicy } from '../members/member.policy.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { FamilyStoryModel } from '../stories/story.model.js';
import type { BookData, BookPerson } from './book.render.js';

const MAX_PEOPLE = 5000;
const MAX_STORIES = 300;
const MAX_PHOTOS = 120;
const MAX_TIMELINE = 2000;
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

/** "12 March 1950", "about 1885" in the book's language. */
export function bookDate(date: FuzzyDate | null | undefined, locale: string, labels: BookLabels): string {
  if (!date) return '';
  if (!date.year) return date.text ?? '';
  let core = String(date.year);
  try {
    if (date.month && date.day) core = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(date.year, date.month - 1, date.day));
    else if (date.month) core = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(date.year, date.month - 1, 1));
  } catch {
    /* unknown locale: the year alone */
  }
  switch (date.qualifier) {
    case 'about':
      return fill(labels.about, { date: core });
    case 'estimated':
      return fill(labels.estimated, { date: core });
    case 'before':
      return fill(labels.before, { date: core });
    case 'after':
      return fill(labels.after, { date: core });
    case 'between':
      return date.endYear ? fill(labels.between, { date: core, end: date.endYear }) : fill(labels.from, { date: core });
    default:
      return core;
  }
}

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join();

/** The words sent by the app, where they keep every `{placeholder}` of the English; English otherwise. */
export function bookLabels(given: Partial<BookLabels> | undefined): BookLabels {
  const usable = Object.entries(given ?? {}).filter(
    ([k, v]) => k in BOOK_LABELS && typeof v === 'string' && v.trim() && placeholders(v) === placeholders(BOOK_LABELS[k as keyof BookLabels]),
  );
  return { ...BOOK_LABELS, ...Object.fromEntries(usable) } as BookLabels;
}

function safeLocale(locale: string | undefined): string {
  try {
    return Intl.getCanonicalLocales(locale ?? 'en')[0] ?? 'en';
  } catch {
    return 'en';
  }
}

interface Graph {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  partners: Map<string, string[]>;
}

async function graph(familyId: Types.ObjectId): Promise<Graph> {
  const edges = await RelationshipModel.find({ familyId, deletedAt: null, verification: { $ne: 'disputed' } }, { type: 1, personA: 1, personB: 1 }).lean();
  const g: Graph = { parents: new Map(), children: new Map(), partners: new Map() };
  const add = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k) ?? [];
    if (!list.includes(v)) list.push(v);
    m.set(k, list);
  };
  for (const e of edges) {
    const a = e.personA.toString();
    const b = e.personB.toString();
    if (e.type === 'parent_child') {
      add(g.children, a, b);
      add(g.parents, b, a);
    } else {
      add(g.partners, a, b);
      add(g.partners, b, a);
    }
  }
  return g;
}

/** People in a branch: the founder's descendants, and their partners. */
function descendantsWithPartners(rootId: string, g: Graph, maxDepth = Infinity): Set<string> {
  const out = new Set<string>();
  let level = [rootId];
  for (let depth = 0; level.length && depth <= maxDepth; depth++) {
    const next: string[] = [];
    for (const id of level) {
      if (out.has(id)) continue;
      out.add(id);
      for (const p of g.partners.get(id) ?? []) out.add(p);
      next.push(...(g.children.get(id) ?? []));
    }
    level = next;
  }
  return out;
}

/** Gathers what the book shows, as the person asking may see it. */
export async function assembleBook(access: FamilyAccess, options: BookOptions, storage: StorageProvider, onProgress: (fraction: number) => void = () => {}): Promise<BookData> {
  const labels = bookLabels(options.labels);
  const locale = safeLocale(options.locale);
  const familyId = access.familyId;
  const policy = new MemberPolicy(access);
  const g = await graph(familyId);
  const docs = (await FamilyMemberModel.find({ familyId, deletedAt: null })).filter((d) => policy.isVisible(d));
  const byId = new Map(docs.map((d) => [d.id as string, d]));

  // Who is in the book, and whose line the tree follows.
  let included: Set<string>;
  let rootId: string | null;
  let defaultTitle = access.family.name;
  if (options.scope === 'branch') {
    const branch = await FamilyBranchModel.findOne({ _id: options.branchId, familyId, deletedAt: null });
    if (!branch) throw new Error('The branch no longer exists');
    rootId = branch.foundingMemberId.toString();
    included = descendantsWithPartners(rootId, g);
    defaultTitle = branch.name;
  } else if (options.scope === 'person') {
    const person = options.personId ? byId.get(options.personId) : undefined;
    if (!person) throw new Error('The person is not in the family, or is hidden from you');
    const depth = options.generations ?? 3;
    // Up: the person's ancestors; the tree starts at the earliest one found along the first parents.
    let top = person.id as string;
    let up = [top];
    const ancestors = new Set<string>();
    for (let i = 0; i < depth && up.length; i++) {
      up = up.flatMap((x) => g.parents.get(x) ?? []).filter((x) => byId.has(x));
      for (const a of up) ancestors.add(a);
      if (up[0]) top = up[0];
    }
    included = new Set([...ancestors, ...descendantsWithPartners(person.id as string, g, depth)]);
    for (const a of ancestors) for (const p of g.partners.get(a) ?? []) included.add(p);
    rootId = top;
    defaultTitle = toPersonCard(person, policy).displayName;
  } else {
    included = new Set(byId.keys());
    rootId = access.family.foundingMemberId?.toString() ?? null;
  }
  const people = [...included].map((id) => byId.get(id)).filter((d): d is FamilyMemberDoc => !!d);
  if (people.length > MAX_PEOPLE) throw new Error(`Books are limited to ${MAX_PEOPLE} people; choose a branch or a person`);
  const ids = new Set(people.map((d) => d.id as string));
  if (rootId && !ids.has(rootId)) rootId = null;

  const namesOnly = (d: FamilyMemberDoc) => policy.detailLevel(d) !== 'full' || (options.living === 'names' && policy.presumedLiving(d));
  const order = (a: FamilyMemberDoc, b: FamilyMemberDoc) =>
    (a.generation?.number ?? 999) - (b.generation?.number ?? 999) || (a.birthDate?.sortKey ?? Infinity) - (b.birthDate?.sortKey ?? Infinity) || toPersonCard(a, policy).displayName.localeCompare(toPersonCard(b, policy).displayName);
  const byBirth = (list: string[]) => list.filter((x) => ids.has(x)).sort((a, b) => (byId.get(a)!.birthDate?.sortKey ?? Infinity) - (byId.get(b)!.birthDate?.sortKey ?? Infinity));
  people.sort(order);

  // Profile photos the person asking may see.
  const visibleMedia = await archiveVisibility(access, 'uploadedBy');
  const photoIds = people.filter((d) => !namesOnly(d) && d.profilePhotoMediaId).map((d) => d.profilePhotoMediaId!);
  const profileMedia = photoIds.length ? await FamilyMediaModel.find({ ...visibleMedia, status: 'published', _id: { $in: photoIds } }, { storageKey: 1, thumbKey: 1 }).lean() : [];
  const profileKeys = new Map(profileMedia.map((m) => [m._id.toString(), m.thumbKey ?? m.storageKey]));
  const toJpeg = async (key: string, size: number) => {
    try {
      return await sharp(await storage.read(key)).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
    } catch {
      return null;
    }
  };

  // Stories about these people.
  const storyDocs = await FamilyStoryModel.find({ ...(await archiveVisibility(access, 'createdBy')), status: 'published', ...(options.scope === 'family' ? {} : { memberIds: { $in: [...ids].map((x) => new Types.ObjectId(x)) } }) })
    .sort({ 'date.sortKey': 1, createdAt: 1 })
    .limit(MAX_STORIES)
    .lean();
  const storiesOf = new Map<string, { id: string; title: string }[]>();
  for (const s of storyDocs) for (const m of s.memberIds) storiesOf.set(m.toString(), [...(storiesOf.get(m.toString()) ?? []), { id: s._id.toString(), title: s.title }]);

  const bookPeople: BookPerson[] = [];
  for (const [i, d] of people.entries()) {
    const card = toPersonCard(d, policy);
    const id = d.id as string;
    const brief = namesOnly(d);
    const born = brief ? '' : [bookDate(card.birthDate, locale, labels), d.birthPlace].filter(Boolean).join(', ');
    const died = brief ? '' : [bookDate(card.deathDate, locale, labels), d.deathPlace].filter(Boolean).join(', ');
    const b = brief ? '' : bookDate(card.birthDate, locale, labels);
    const e = brief ? '' : bookDate(card.deathDate, locale, labels);
    const photoKey = !brief && d.profilePhotoMediaId ? profileKeys.get(d.profilePhotoMediaId.toString()) : undefined;
    bookPeople.push({
      id,
      name: card.displayName,
      lifespan: e ? `${b || '?'} – ${e}` : b ? `${b} –` : '',
      generation: d.generation?.number ?? null,
      era: brief ? '' : ((era) => (era ? labels[BOOK_ERA_LABEL[era.key]] : ''))(birthEraOf(card.birthDate)),
      born,
      died,
      hometown: brief ? '' : d.hometown,
      parents: byBirth(g.parents.get(id) ?? []),
      partners: (g.partners.get(id) ?? []).filter((x) => ids.has(x)),
      children: byBirth(g.children.get(id) ?? []),
      occupations: brief ? [] : (d.occupations ?? []).map((o) => [o.title, o.organisation].filter(Boolean).join(', ')),
      education: brief ? [] : (d.education ?? []).map((o) => [o.title, o.organisation].filter(Boolean).join(', ')),
      biography: brief ? '' : (d.biography ?? ''),
      photo: photoKey ? await toJpeg(photoKey, 600) : null,
      stories: brief ? [] : (storiesOf.get(id) ?? []),
    });
    if (i % 50 === 0) onProgress((i / people.length) * 0.5);
  }
  const nameOf = new Map(bookPeople.map((p) => [p.id, p.name]));

  // The timeline: events, births and deaths, in date order.
  const timeline: { sortKey: number; date: string; text: string }[] = [];
  const events = await FamilyEventModel.find({ ...(await archiveVisibility(access, 'createdBy', false)), 'date.sortKey': { $ne: null } }).lean();
  for (const ev of events) {
    const people = ev.memberIds.map((m) => nameOf.get(m.toString())).filter(Boolean);
    if (options.scope !== 'family' && !people.length) continue;
    timeline.push({ sortKey: ev.date!.sortKey!, date: bookDate(toFuzzyDate(ev.date), locale, labels), text: [ev.title, ev.place].filter(Boolean).join(' — ') });
  }
  for (const d of people) {
    if (namesOnly(d)) continue;
    const card = toPersonCard(d, policy);
    const name = card.displayName;
    if (d.birthDate?.sortKey != null && card.birthDate) timeline.push({ sortKey: d.birthDate.sortKey, date: bookDate(card.birthDate, locale, labels), text: [fill(labels.bornEvent, { name }), d.birthPlace].filter(Boolean).join(' — ') });
    if (d.deathDate?.sortKey != null && card.deathDate) timeline.push({ sortKey: d.deathDate.sortKey, date: bookDate(card.deathDate, locale, labels), text: [fill(labels.diedEvent, { name }), d.deathPlace].filter(Boolean).join(' — ') });
  }
  timeline.sort((a, b) => a.sortKey - b.sortKey);

  // Photographs of these people.
  const photos: BookData['photos'] = [];
  if (options.include.photos) {
    const media = await FamilyMediaModel.find({ ...visibleMedia, status: 'published', kind: 'photo', ...(options.scope === 'family' ? {} : { memberIds: { $in: [...ids].map((x) => new Types.ObjectId(x)) } }) })
      .sort({ 'date.sortKey': 1, createdAt: 1 })
      .limit(MAX_PHOTOS)
      .lean();
    for (const [i, m] of media.entries()) {
      const image = await toJpeg(m.storageKey, 1400);
      if (!image) continue;
      const who = m.memberIds.map((x) => nameOf.get(x.toString())).filter(Boolean).join(', ');
      photos.push({ image, caption: [m.title, bookDate(toFuzzyDate(m.date), locale, labels), who].filter(Boolean).join(' · ') });
      if (i % 10 === 0) onProgress(0.5 + (i / media.length) * 0.2);
    }
  }

  const root = rootId ? nameOf.get(rootId) : undefined;
  return {
    familyName: access.family.name,
    title: options.title?.trim() || defaultTitle,
    subtitle: options.subtitle?.trim() || (root ? fill(options.scope === 'person' ? labels.familyOf : labels.descendantsOf, { name: root }) : ''),
    madeOn: fill(labels.madeOn, { date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date()) }),
    rootId,
    people: bookPeople,
    stories: storyDocs.map((s) => ({
      id: s._id.toString(),
      title: s.title,
      byline: [s.narrator ? fill(labels.toldBy, { name: s.narrator }) : '', bookDate(toFuzzyDate(s.date), locale, labels)].filter(Boolean).join(' · '),
      text: s.body.slice(0, 30_000),
    })),
    timeline: timeline.slice(0, MAX_TIMELINE).map(({ date, text }) => ({ date, text })),
    photos,
    include: options.include,
    livingNote: options.living === 'names' && people.some((d) => policy.presumedLiving(d)),
    labels,
    paper: options.paper,
    language: locale,
  };
}
