import { Types } from 'mongoose';
import { z } from 'zod';
import {
  CEREMONY_KINDS,
  EVENT_KINDS,
  fuzzyDateSortKey,
  isCeremony,
  type ArchivePrivacy,
  type EventKind,
  type EventView,
  type FuzzyDate,
  type MediaView,
  type PersonCard,
  type StoryKind,
  type TimelineItem,
} from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { fuzzyDateSchema } from '../../core/fuzzy-date.js';
import { objectId } from '../../core/validation.js';
import type { AuditService } from '../audit/audit.service.js';
import { archivePrivacy, archiveVisibility, assertPeople, idList, peopleCards } from '../archive/archive.shared.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toFuzzyDate, toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { sourceReference } from '../members/member.validators.js';
import { FamilyMediaModel } from '../media/media.model.js';
import { mediaContentPath, type MediaService } from '../media/media.service.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import type { Actor } from '../relationships/relationships.service.js';
import { FamilyStoryModel } from '../stories/story.model.js';
import { FamilyEventModel, type FamilyEventDoc } from './event.model.js';
import { FamilyFundModel } from '../finance/fund.model.js';

const eventFields = {
  kind: z.enum(EVENT_KINDS),
  title: z.string().trim().min(1, 'Give the event a title').max(200),
  description: z.string().trim().max(20_000),
  date: fuzzyDateSchema.nullable(),
  place: z.string().trim().max(200),
  memberIds: idList,
  mediaIds: idList,
  sources: z.array(sourceReference).max(50),
  privacy: archivePrivacy,
  programme: z
    .array(
      z
        .object({
          time: z.string().trim().max(40).default(''),
          title: z.string().trim().min(1, 'Describe this part of the programme').max(200),
          detail: z.string().trim().max(1000).optional(),
          lead: z.string().trim().max(120).optional(),
        })
        .strict(),
    )
    .max(60),
  roles: z
    .array(
      z
        .object({ role: z.string().trim().min(1, 'Name the role').max(80), memberId: objectId.nullable().optional(), name: z.string().trim().max(120).optional() })
        .strict()
        .refine((r) => !!r.memberId || !!r.name, { message: 'Choose a person or enter a name', path: ['name'] }),
    )
    .max(60),
  fundId: objectId.nullable(),
};
export const createEventBody = z.object(eventFields).partial().required({ kind: true, title: true }).strict();
export const updateEventBody = z.object(eventFields).partial().extend({ version: z.number().int().min(0) }).strict();
export const eventListQuery = z.object({ kind: z.enum(EVENT_KINDS).optional(), memberId: objectId.optional(), ceremonies: z.enum(['true', 'false']).optional() });
export const timelineQuery = z.object({
  memberId: objectId.optional(),
  from: z.coerce.number().int().min(0).max(3000).optional(),
  to: z.coerce.number().int().min(0).max(3000).optional(),
  include: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : ['events', 'stories', 'records']))
    .pipe(z.array(z.enum(['events', 'stories', 'records']))),
});

/** The timeline never returns more than this many lines at once; narrow it with from/to. */
const TIMELINE_LIMIT = 2000;
const MARRIAGE_SUBTYPES = ['marriage', 'customary_marriage', 'civil_union'];

type EventPatch = Partial<z.output<z.ZodObject<typeof eventFields>>>;

/** Recorded family events (reunions, migrations, ceremonies, …) and the combined family timeline. */
/** Administrators and moderators, and the people holding a role at a ceremony (its organisers), may message relatives about it. */
export function mayAnnounce(access: FamilyAccess, e: { kind: string; roles: { memberId?: Types.ObjectId | null }[] }): boolean {
  if (!access.membership || !isCeremony(e.kind as EventKind)) return false;
  if (access.can('event.manage')) return true;
  const own = access.ownProfileId;
  return !!own && e.roles.some((r) => r.memberId?.equals(own));
}

export class EventsService {
  constructor(
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  private async load(access: FamilyAccess, id: Types.ObjectId): Promise<FamilyEventDoc> {
    const e = await FamilyEventModel.findOne({ ...(await archiveVisibility(access, 'createdBy', false)), _id: id });
    if (!e) throw AppError.notFound('Event');
    return e;
  }

  private async apply(access: FamilyAccess, e: FamilyEventDoc, patch: EventPatch): Promise<void> {
    for (const key of ['kind', 'title', 'description', 'place', 'privacy'] as const) {
      if (patch[key] !== undefined) e.set(key, patch[key]);
    }
    if (patch.date !== undefined) e.set('date', patch.date);
    if (patch.sources !== undefined) e.set('sources', patch.sources);
    if (patch.programme !== undefined) e.set('programme', patch.programme);
    if (patch.roles !== undefined) {
      const ids = patch.roles.map((r) => r.memberId).filter((id): id is string => !!id);
      await assertPeople(access, ids);
      e.set('roles', patch.roles.map((r) => ({ role: r.role, memberId: r.memberId ? new Types.ObjectId(r.memberId) : null, name: r.name ?? '' })));
    }
    if (patch.fundId !== undefined) {
      if (patch.fundId && !(await FamilyFundModel.exists({ _id: patch.fundId, familyId: access.familyId, deletedAt: null }))) {
        throw new AppError('VALIDATION_FAILED', 'That fund is not in this family', [{ path: 'fundId', message: 'Unknown fund' }]);
      }
      e.set('fundId', patch.fundId ? new Types.ObjectId(patch.fundId) : null);
    }
    if (patch.memberIds !== undefined) e.memberIds = await assertPeople(access, patch.memberIds);
    if (patch.mediaIds !== undefined) {
      const unique = [...new Set(patch.mediaIds)];
      const found = unique.length ? await FamilyMediaModel.countDocuments({ ...(await archiveVisibility(access, 'uploadedBy')), _id: { $in: unique } }) : 0;
      if (found !== unique.length) throw new AppError('VALIDATION_FAILED', 'Some of these files are not in the family archive', [{ path: 'mediaIds', message: 'Unknown file' }]);
      e.mediaIds = unique.map((id) => new Types.ObjectId(id));
    }
  }

  async toViews(access: FamilyAccess, docs: FamilyEventDoc[]): Promise<EventView[]> {
    const people = await peopleCards(access, docs.flatMap((d) => [...d.memberIds, ...d.roles.map((r) => r.memberId).filter((id): id is Types.ObjectId => !!id)]));
    const fundIds = docs.map((d) => d.fundId).filter((id): id is Types.ObjectId => !!id);
    // Linked funds are shown to those who may see them (administrators and treasurers see every fund).
    const funds = fundIds.length && access.can('finance.view')
      ? await FamilyFundModel.find({ _id: { $in: fundIds }, familyId: access.familyId, deletedAt: null, ...(access.can('finance.manage') ? {} : { visibility: { $ne: 'admins' } }) }, { name: 1 }).lean()
      : [];
    // Files attached to the event, or uploaded with the event selected.
    const mediaDocs = docs.length
      ? await FamilyMediaModel.find({ ...(await archiveVisibility(access, 'uploadedBy')), $or: [{ _id: { $in: docs.flatMap((d) => d.mediaIds) } }, { eventId: { $in: docs.map((d) => d._id) } }] }).sort({ createdAt: 1 })
      : [];
    const media = await this.media.toViews(access, mediaDocs);
    const canEdit = access.can('event.manage');
    return docs.map((e) => {
      const own = new Set(e.mediaIds.map(String));
      return {
        id: e.id as string,
        kind: e.kind as EventKind,
        title: e.title,
        description: e.description,
        date: toFuzzyDate(e.date),
        place: e.place,
        people: e.memberIds.map((id) => people.get(id.toString())).filter((p): p is PersonCard => !!p),
        media: media.filter((m: MediaView) => own.has(m.id) || m.eventId === e.id),
        sources: e.sources.map((x) => ({ title: x.title, ...(x.citation ? { citation: x.citation } : {}), ...(x.url ? { url: x.url } : {}) })),
        privacy: e.privacy as ArchivePrivacy,
        programme: e.programme.map((p) => ({ time: p.time, title: p.title, ...(p.detail ? { detail: p.detail } : {}), ...(p.lead ? { lead: p.lead } : {}) })),
        roles: e.roles.map((r) => ({ role: r.role, person: r.memberId ? (people.get(r.memberId.toString()) ?? null) : null, name: r.name || (r.memberId ? (people.get(r.memberId.toString())?.displayName ?? '') : '') })),
        fund: ((f) => (f ? { id: f._id.toString(), name: f.name } : null))(funds.find((f) => e.fundId && f._id.equals(e.fundId))),
        createdAt: e.createdAt.toISOString(),
        viewerCan: { edit: canEdit, delete: canEdit, announce: mayAnnounce(access, e) },
        version: e.get('version') as number,
      };
    });
  }

  async list(access: FamilyAccess, query: z.output<typeof eventListQuery>): Promise<EventView[]> {
    access.assert('media.view', { isPublic: true });
    const filter: Record<string, unknown> = await archiveVisibility(access, 'createdBy', false);
    if (query.kind) filter['kind'] = query.kind;
    if (query.memberId) filter['memberIds'] = new Types.ObjectId(query.memberId);
    if (query.ceremonies === 'true' && !query.kind) filter['kind'] = { $in: CEREMONY_KINDS };
    const rows = await FamilyEventModel.find(filter).sort({ 'date.sortKey': 1, createdAt: 1 }).limit(1000);
    return this.toViews(access, rows);
  }

  async get(access: FamilyAccess, id: Types.ObjectId): Promise<EventView> {
    return (await this.toViews(access, [await this.load(access, id)]))[0]!;
  }

  async create(access: FamilyAccess, actor: Actor, input: z.output<typeof createEventBody>): Promise<EventView> {
    access.assert('event.manage');
    const e = new FamilyEventModel({ familyId: access.familyId, createdBy: actor.userId, kind: input.kind, title: input.title });
    await this.apply(access, e, input);
    await e.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'event.create', targetType: 'event', targetId: e._id, after: e.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.get(access, e._id);
  }

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: z.output<typeof updateEventBody>): Promise<EventView> {
    access.assert('event.manage');
    const e = await this.load(access, id);
    if ((e.get('version') as number) !== patch.version) throw new AppError('VERSION_CONFLICT', 'This event was changed by someone else. Reload and try again.');
    const before = e.toObject();
    const { version: _v, ...fields } = patch;
    await this.apply(access, e, fields);
    await e.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'event.update', targetType: 'event', targetId: e._id, before, after: e.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.get(access, e._id);
  }

  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    access.assert('event.manage');
    const e = await this.load(access, id);
    e.deletedAt = new Date();
    e.deletedBy = actor.userId;
    await e.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'event.delete', targetType: 'event', targetId: e._id, before: { title: e.title, kind: e.kind }, requestId: actor.requestId, ip: actor.ip });
  }

  // ------------------------------------------------------------------ timeline

  /**
   * Recorded events and dated stories, plus births, deaths and marriages taken from people's records.
   * Derived lines follow the profile privacy rules: people hidden from the viewer are left out, names-only
   * profiles contribute nothing, and children's or opted-out dates are shown as a year only.
   */
  async timeline(access: FamilyAccess, query: z.output<typeof timelineQuery>): Promise<{ data: TimelineItem[]; meta: { truncated: boolean } }> {
    access.assert('member.view', { isPublic: true });
    const lo = query.from != null ? query.from * 10000 : null;
    const hi = query.to != null ? query.to * 10000 + 9999 : null;
    const inRange = (key: number | null | undefined) => key != null && (lo == null || key >= lo) && (hi == null || key <= hi);
    const dateRange = { $ne: null, ...(lo != null ? { $gte: lo } : {}), ...(hi != null ? { $lte: hi } : {}) };
    const memberId = query.memberId ? new Types.ObjectId(query.memberId) : null;
    const items: TimelineItem[] = [];
    const policy = new MemberPolicy(access);

    if (query.include.includes('events')) {
      const filter: Record<string, unknown> = { ...(await archiveVisibility(access, 'createdBy', false)), 'date.sortKey': dateRange };
      if (memberId) filter['memberIds'] = memberId;
      const events = await FamilyEventModel.find(filter).sort({ 'date.sortKey': 1 }).limit(TIMELINE_LIMIT);
      const people = await peopleCards(access, events.flatMap((e) => e.memberIds));
      const photos = await FamilyMediaModel.find(
        { ...(await archiveVisibility(access, 'uploadedBy')), kind: 'photo', $or: [{ _id: { $in: events.flatMap((e) => e.mediaIds) } }, { eventId: { $in: events.map((e) => e._id) } }] },
        { _id: 1, eventId: 1 },
      ).lean();
      for (const e of events) {
        const photo = photos.find((p) => e.mediaIds.some((id) => id.equals(p._id)) || p.eventId?.equals(e._id));
        items.push({
          key: `event:${e.id as string}`,
          source: 'event',
          kind: e.kind as EventKind,
          title: e.title,
          date: toFuzzyDate(e.date)!,
          place: e.place,
          people: e.memberIds.map((id) => people.get(id.toString())).filter((p): p is PersonCard => !!p),
          eventId: e.id as string,
          storyId: null,
          thumbUrl: photo ? mediaContentPath(access.familyId, photo._id, 'thumb') : null,
        });
      }
    }

    if (query.include.includes('stories')) {
      const filter: Record<string, unknown> = { ...(await archiveVisibility(access, 'createdBy')), status: 'published', 'date.sortKey': dateRange };
      if (memberId) filter['memberIds'] = memberId;
      const stories = await FamilyStoryModel.find(filter, { body: 0 }).sort({ 'date.sortKey': 1 }).limit(TIMELINE_LIMIT);
      const people = await peopleCards(access, stories.flatMap((s) => s.memberIds));
      for (const s of stories) {
        items.push({
          key: `story:${s.id as string}`,
          source: 'story',
          kind: s.kind as StoryKind,
          title: s.title,
          date: toFuzzyDate(s.date)!,
          place: s.place,
          people: s.memberIds.map((id) => people.get(id.toString())).filter((p): p is PersonCard => !!p),
          eventId: s.eventId?.toString() ?? null,
          storyId: s.id as string,
          thumbUrl: null,
        });
      }
    }

    if (query.include.includes('records')) {
      const filter: Record<string, unknown> = { familyId: access.familyId, deletedAt: null, ...policy.visibilityFilter() };
      if (memberId) filter['_id'] = memberId;
      filter['$or'] = [{ 'birthDate.sortKey': dateRange }, { 'deathDate.sortKey': dateRange }];
      const people = await FamilyMemberModel.find(filter).limit(TIMELINE_LIMIT * 2);
      const cardOf = new Map<string, PersonCard>();
      for (const m of people) {
        if (!policy.isVisible(m) || policy.detailLevel(m) !== 'full') continue;
        const card = toPersonCard(m, policy);
        cardOf.set(m.id as string, card);
        if (card.birthDate && inRange(m.birthDate?.sortKey)) {
          items.push({ key: `birth:${m.id as string}`, source: 'record', kind: 'birth', title: `${card.displayName} was born`, date: card.birthDate, place: policy.reduceDates(m) ? '' : m.birthPlace, people: [card], eventId: null, storyId: null, thumbUrl: card.photoUrl });
        }
        if (card.deathDate && inRange(m.deathDate?.sortKey)) {
          items.push({ key: `death:${m.id as string}`, source: 'record', kind: 'death', title: `${card.displayName} died`, date: card.deathDate, place: m.deathPlace, people: [card], eventId: null, storyId: null, thumbUrl: card.photoUrl });
        }
      }

      // Marriages: both partners must be visible with full profiles.
      const edgeFilter: Record<string, unknown> = { familyId: access.familyId, deletedAt: null, type: 'partnership', subtype: { $in: MARRIAGE_SUBTYPES }, 'startDate.sortKey': dateRange };
      if (memberId) edgeFilter['$or'] = [{ personA: memberId }, { personB: memberId }];
      const edges = await RelationshipModel.find(edgeFilter).limit(TIMELINE_LIMIT);
      const missing = edges.flatMap((e) => [e.personA, e.personB]).filter((id) => !cardOf.has(id.toString()));
      if (missing.length) {
        for (const m of await FamilyMemberModel.find({ _id: { $in: missing }, familyId: access.familyId, deletedAt: null })) {
          if (policy.isVisible(m) && policy.detailLevel(m) === 'full') cardOf.set(m.id as string, toPersonCard(m, policy));
        }
      }
      for (const e of edges) {
        const a = cardOf.get(e.personA.toString());
        const b = cardOf.get(e.personB.toString());
        const date = toFuzzyDate(e.startDate) as FuzzyDate | null;
        if (!a || !b || !date) continue;
        items.push({ key: `marriage:${e.id as string}`, source: 'record', kind: 'marriage', title: `${a.displayName} and ${b.displayName} married`, date, place: '', people: [a, b], eventId: null, storyId: null, thumbUrl: null });
      }
    }

    items.sort((x, y) => (fuzzyDateSortKey(x.date) ?? 0) - (fuzzyDateSortKey(y.date) ?? 0) || x.title.localeCompare(y.title));
    return { data: items.slice(0, TIMELINE_LIMIT), meta: { truncated: items.length > TIMELINE_LIMIT } };
  }
}
