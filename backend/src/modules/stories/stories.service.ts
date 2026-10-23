import { Types } from 'mongoose';
import { z } from 'zod';
import { STORY_KINDS, type ArchivePrivacy, type ArchiveStatus, type MediaView, type PersonCard, type StoryKind, type StoryView } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { fuzzyDateSchema } from '../../core/fuzzy-date.js';
import { objectId, pageMeta } from '../../core/validation.js';
import type { AuditService } from '../audit/audit.service.js';
import {
  archivePrivacy,
  archiveVisibility,
  assertPeople,
  idList,
  peopleCards,
  searchFilter,
  searchTextOf,
  userNames,
  type ArchiveReviewQueue,
} from '../archive/archive.shared.js';
import { FamilyEventModel } from '../events/event.model.js';
import type { FamilyAccess } from '../families/family-access.js';
import { toFuzzyDate } from '../members/member.mapper.js';
import { sourceReference } from '../members/member.validators.js';
import { FamilyMediaModel } from '../media/media.model.js';
import type { MediaService } from '../media/media.service.js';
import type { Actor } from '../relationships/relationships.service.js';
import { FamilyStoryModel, type FamilyStoryDoc } from './story.model.js';

const storyFields = {
  kind: z.enum(STORY_KINDS),
  title: z.string().trim().min(1, 'Give the story a title').max(200),
  body: z.string().trim().max(100_000),
  narrator: z.string().trim().max(200),
  date: fuzzyDateSchema.nullable(),
  place: z.string().trim().max(200),
  memberIds: idList,
  eventId: objectId.nullable(),
  mediaIds: idList,
  recordingMediaId: objectId.nullable(),
  sources: z.array(sourceReference).max(50),
  privacy: archivePrivacy,
};

export const createStoryBody = z
  .object({ ...storyFields, note: z.string().trim().max(2000).optional() })
  .partial()
  .required({ kind: true, title: true })
  .strict()
  .refine((s) => (s.body ?? '').length > 0 || !!s.recordingMediaId, { message: 'Write the story or attach a recording', path: ['body'] });
export const updateStoryBody = z.object(storyFields).partial().extend({ version: z.number().int().min(0) }).strict();
export const storyListQuery = z.object({
  kind: z.enum(STORY_KINDS).optional(),
  memberId: objectId.optional(),
  eventId: objectId.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['pending_approval', 'published', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

type StoryPatch = Partial<z.output<z.ZodObject<typeof storyFields>>>;

/** Stories, oral histories, traditions and memories. */
export class StoriesService {
  private review: ArchiveReviewQueue | null = null;

  constructor(
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  attachReview(queue: ArchiveReviewQueue): void {
    this.review = queue;
  }

  private canEdit(access: FamilyAccess, s: Pick<FamilyStoryDoc, 'createdBy'>): boolean {
    const own = access.membership ? s.createdBy.equals(access.membership.userId) : false;
    return access.can('story.manage', { ownedByViewer: own });
  }

  async load(access: FamilyAccess, id: Types.ObjectId): Promise<FamilyStoryDoc> {
    const s = await FamilyStoryModel.findOne({ ...(await archiveVisibility(access, 'createdBy')), _id: id });
    if (!s) throw AppError.notFound('Story');
    return s;
  }

  /** Files that the viewer may attach: live files of this family they can see. */
  private async assertMedia(access: FamilyAccess, ids: string[] | undefined, path: string, kinds?: string[]): Promise<Types.ObjectId[]> {
    const unique = [...new Set(ids ?? [])];
    if (!unique.length) return [];
    const filter: Record<string, unknown> = { ...(await archiveVisibility(access, 'uploadedBy')), _id: { $in: unique } };
    if (kinds) filter['kind'] = { $in: kinds };
    if ((await FamilyMediaModel.countDocuments(filter)) !== unique.length) {
      throw new AppError('VALIDATION_FAILED', kinds ? 'Attach an audio or video recording' : 'Some of these files are not in the family archive', [{ path, message: 'Unknown file' }]);
    }
    return unique.map((id) => new Types.ObjectId(id));
  }

  private async assertEvent(access: FamilyAccess, id: string | null | undefined): Promise<Types.ObjectId | null> {
    if (!id) return null;
    if (!(await FamilyEventModel.exists({ _id: id, familyId: access.familyId, deletedAt: null }))) {
      throw new AppError('VALIDATION_FAILED', 'That event is not in the family timeline', [{ path: 'eventId', message: 'Unknown event' }]);
    }
    return new Types.ObjectId(id);
  }

  private async apply(access: FamilyAccess, s: FamilyStoryDoc, patch: StoryPatch): Promise<void> {
    for (const key of ['kind', 'title', 'body', 'narrator', 'place', 'privacy'] as const) {
      if (patch[key] !== undefined) s.set(key, patch[key]);
    }
    if (patch.date !== undefined) s.set('date', patch.date);
    if (patch.sources !== undefined) s.set('sources', patch.sources);
    if (patch.memberIds !== undefined) s.memberIds = await assertPeople(access, patch.memberIds);
    if (patch.eventId !== undefined) s.eventId = await this.assertEvent(access, patch.eventId);
    if (patch.mediaIds !== undefined) s.mediaIds = await this.assertMedia(access, patch.mediaIds, 'mediaIds');
    if (patch.recordingMediaId !== undefined) {
      s.recordingMediaId = patch.recordingMediaId ? (await this.assertMedia(access, [patch.recordingMediaId], 'recordingMediaId', ['audio', 'video']))[0]! : null;
    }
    s.searchText = searchTextOf(s.title, s.narrator, s.place, s.body.slice(0, 4000));
  }

  async toViews(access: FamilyAccess, docs: FamilyStoryDoc[]): Promise<StoryView[]> {
    const people = await peopleCards(access, docs.flatMap((d) => d.memberIds));
    const names = await userNames(docs.map((d) => d.createdBy));
    const mediaIds = docs.flatMap((d) => [...d.mediaIds, ...(d.recordingMediaId ? [d.recordingMediaId] : [])]);
    const mediaDocs = mediaIds.length ? await FamilyMediaModel.find({ ...(await archiveVisibility(access, 'uploadedBy')), _id: { $in: mediaIds } }) : [];
    const media = new Map((await this.media.toViews(access, mediaDocs)).map((m) => [m.id, m]));
    return docs.map((s) => {
      const canEdit = this.canEdit(access, s);
      return {
        id: s.id as string,
        kind: s.kind as StoryKind,
        title: s.title,
        body: s.body,
        narrator: s.narrator,
        date: toFuzzyDate(s.date),
        place: s.place,
        people: s.memberIds.map((id) => people.get(id.toString())).filter((p): p is PersonCard => !!p),
        eventId: s.eventId?.toString() ?? null,
        media: s.mediaIds.map((id) => media.get(id.toString())).filter((m): m is MediaView => !!m),
        recording: s.recordingMediaId ? (media.get(s.recordingMediaId.toString()) ?? null) : null,
        sources: s.sources.map((x) => ({ title: x.title, ...(x.citation ? { citation: x.citation } : {}), ...(x.url ? { url: x.url } : {}) })),
        privacy: s.privacy as ArchivePrivacy,
        status: s.status as ArchiveStatus,
        createdBy: access.membership ? { id: s.createdBy.toString(), displayName: names.get(s.createdBy.toString()) ?? 'Former member' } : null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        viewerCan: { edit: canEdit, delete: canEdit },
        version: s.get('version') as number,
      };
    });
  }

  async view(access: FamilyAccess, id: Types.ObjectId): Promise<StoryView> {
    return (await this.toViews(access, [await this.load(access, id)]))[0]!;
  }

  async list(access: FamilyAccess, query: z.output<typeof storyListQuery>) {
    access.assert('media.view', { isPublic: true });
    const filter: Record<string, unknown> = { ...(await archiveVisibility(access, 'createdBy')), ...searchFilter(query.q) };
    if (query.kind) filter['kind'] = query.kind;
    if (query.memberId) filter['memberIds'] = new Types.ObjectId(query.memberId);
    if (query.eventId) filter['eventId'] = new Types.ObjectId(query.eventId);
    if (query.status) filter['status'] = query.status;
    const [rows, total] = await Promise.all([
      FamilyStoryModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize),
      FamilyStoryModel.countDocuments(filter),
    ]);
    return { data: await this.toViews(access, rows), meta: pageMeta(query, total) };
  }

  async create(access: FamilyAccess, actor: Actor, input: z.output<typeof createStoryBody>): Promise<StoryView> {
    const direct = access.can('story.create');
    if (!direct && !(access.membership && access.canPropose('story.create'))) throw AppError.forbidden();
    const { note, ...fields } = input;
    const s = new FamilyStoryModel({ familyId: access.familyId, createdBy: actor.userId, status: direct ? 'published' : 'pending_approval', kind: fields.kind, title: fields.title });
    await this.apply(access, s, fields);
    await s.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'story.create', targetType: 'story', targetId: s._id, after: { title: s.title, kind: s.kind, status: s.status }, requestId: actor.requestId, ip: actor.ip });
    if (!direct) await this.review!.fileArchiveItem(access, actor, { kind: 'story.create', targetType: 'story', targetId: s._id, memberIds: s.memberIds, note });
    return this.view(access, s._id);
  }

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: z.output<typeof updateStoryBody>): Promise<StoryView> {
    const s = await this.load(access, id);
    if (!this.canEdit(access, s)) throw AppError.forbidden();
    if ((s.get('version') as number) !== patch.version) throw new AppError('VERSION_CONFLICT', 'This story was changed by someone else. Reload and try again.');
    const before = s.toObject();
    const { version: _v, ...fields } = patch;
    await this.apply(access, s, fields);
    if (!s.body && !s.recordingMediaId) throw new AppError('VALIDATION_FAILED', 'Write the story or attach a recording', [{ path: 'body', message: 'Required' }]);
    s.updatedBy = actor.userId;
    await s.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'story.update', targetType: 'story', targetId: s._id, before, after: s.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.view(access, s._id);
  }

  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    const s = await this.load(access, id);
    if (!this.canEdit(access, s)) throw AppError.forbidden();
    s.deletedAt = new Date();
    s.deletedBy = actor.userId;
    await s.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'story.delete', targetType: 'story', targetId: s._id, before: { title: s.title, kind: s.kind }, requestId: actor.requestId, ip: actor.ip });
  }

  // ------------------------------------------------------------------ review hooks

  async loadAny(access: FamilyAccess, id: Types.ObjectId | null | undefined): Promise<FamilyStoryDoc | null> {
    return id ? FamilyStoryModel.findOne({ _id: id, familyId: access.familyId }) : null;
  }

  async setStatus(access: FamilyAccess, actor: Actor, id: Types.ObjectId, status: 'published' | 'rejected', contributionId: Types.ObjectId): Promise<void> {
    const s = await FamilyStoryModel.findOne({ _id: id, familyId: access.familyId, deletedAt: null });
    if (!s) throw new AppError('CONFLICT', 'The story has been removed in the meantime.');
    s.status = status;
    await s.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: status === 'published' ? 'story.publish' : 'story.reject', targetType: 'story', targetId: s._id, after: { status, title: s.title }, contributionId, requestId: actor.requestId, ip: actor.ip });
  }
}
