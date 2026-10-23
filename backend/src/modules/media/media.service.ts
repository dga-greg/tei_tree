import { stat } from 'node:fs/promises';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import type { ArchivePrivacy, ArchiveStatus, MediaKind, MediaView, PersonCard, TranscriptStatus } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { fuzzyDateSchema } from '../../core/fuzzy-date.js';
import { objectId, pageMeta, parse } from '../../core/validation.js';
import type { StorageProvider } from '../../infra/storage.js';
import type { AuditService } from '../audit/audit.service.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toFuzzyDate } from '../members/member.mapper.js';
import type { Actor } from '../relationships/relationships.service.js';
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
import { FamilyMediaModel, type FamilyMediaDoc } from './media.model.js';
import { processImage, receiveUpload, sniff } from './media.upload.js';
import { mediaSearchText, type TranscriptionService } from './transcription.service.js';

/**
 * Same-origin link that checks permission, then redirects to a short-lived signed file URL. `ngsw-bypass` keeps
 * the app's service worker out of the way: it would re-fetch the redirect itself, under its own (possibly stale)
 * security policy, and signed links expire too soon to be worth caching.
 */
export function mediaContentPath(familyId: string | Types.ObjectId, mediaId: string | Types.ObjectId, variant: 'original' | 'thumb' | 'download'): string {
  const base = `/api/v1/families/${String(familyId)}/media/${String(mediaId)}/content`;
  return variant === 'original' ? `${base}?ngsw-bypass=1` : variant === 'thumb' ? `${base}?variant=thumb&ngsw-bypass=1` : `${base}?download=1&ngsw-bypass=1`;
}

const json = <S extends z.ZodType>(schema: S) =>
  z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema);

const provenance = z
  .object({ source: z.string().trim().max(500).optional(), citation: z.string().trim().max(2000).optional(), originalHolder: z.string().trim().max(200).optional() })
  .strict();

const uploadFields = z
  .object({
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    date: json(fuzzyDateSchema.nullable()).optional(),
    memberIds: json(idList).optional(),
    eventId: objectId.optional(),
    privacy: archivePrivacy.optional(),
    provenance: json(provenance).optional(),
    note: z.string().trim().max(2000).optional(),
    /** The person whose profile photo this is to be. */
    profileOf: objectId.optional(),
  })
  .strict();

/** Profile photos are set by MembersService; attached at start-up. */
export interface ProfilePhotos {
  profilePhotoMode(access: FamilyAccess, id: Types.ObjectId): Promise<'direct' | 'propose' | null>;
  setProfilePhoto(access: FamilyAccess, actor: Actor, id: Types.ObjectId, mediaId: Types.ObjectId): Promise<void>;
}

export const updateMediaBody = z
  .object({
    version: z.number().int().min(0),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    date: fuzzyDateSchema.nullable().optional(),
    memberIds: idList.optional(),
    eventId: objectId.nullable().optional(),
    privacy: archivePrivacy.optional(),
    provenance: provenance.optional(),
  })
  .strict();

const box = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) })
  .strict()
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, 'The box must lie within the photo');
export const tagsBody = z.object({ version: z.number().int().min(0), tags: z.array(z.object({ memberId: objectId, box }).strict()).max(100) }).strict();
const language = z.string().trim().max(60);
export const transcriptBody = z
  .object({
    version: z.number().int().min(0),
    text: z.string().trim().max(200_000),
    language: language.optional(),
    translation: z.object({ text: z.string().trim().max(200_000), language }).strict().nullable().optional(),
  })
  .strict();
export const transcribeBody = z.object({ translate: z.boolean().default(false) }).strict();

export const mediaListQuery = z.object({
  kind: z.enum(['photo', 'document', 'audio', 'video']).optional(),
  memberId: objectId.optional(),
  eventId: objectId.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['pending_approval', 'published', 'rejected']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(48),
});

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/**
 * The family's photographs, documents, recordings and videos. Files are re-encoded or checked on the
 * way in, stored privately, and served through signed links issued after a permission check.
 */
export class MediaService {
  private review: ArchiveReviewQueue | null = null;

  constructor(
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
    private readonly maxBytes: number,
  ) {}

  attachReview(queue: ArchiveReviewQueue): void {
    this.review = queue;
  }

  private profiles: ProfilePhotos | null = null;
  attachProfiles(p: ProfilePhotos): void {
    this.profiles = p;
  }

  private transcription: TranscriptionService | null = null;
  attachTranscription(t: TranscriptionService): void {
    this.transcription = t;
  }

  private canEdit(access: FamilyAccess, m: Pick<FamilyMediaDoc, 'uploadedBy'>): boolean {
    const own = access.membership ? m.uploadedBy.equals(access.membership.userId) : false;
    return access.can('media.delete', { ownedByViewer: own });
  }

  /** Whether uploads by this viewer are published at once, go to review, or are refused. */
  private uploadMode(access: FamilyAccess): 'direct' | 'review' {
    if (access.can('media.upload')) return 'direct';
    // Uploads that need review go to the suggestions queue, when this build has one.
    if (this.review && access.membership && access.canPropose('media.upload')) {
      if (access.family.privacy?.allowMemberUploads === false) throw AppError.forbidden('This family does not accept uploads from members. Ask an administrator to add the file.');
      return 'review';
    }
    throw AppError.forbidden();
  }

  async load(access: FamilyAccess, id: Types.ObjectId): Promise<FamilyMediaDoc> {
    const m = await FamilyMediaModel.findOne({ ...(await archiveVisibility(access, 'uploadedBy')), _id: id });
    if (!m) throw AppError.notFound('File');
    return m;
  }

  async toViews(access: FamilyAccess, docs: FamilyMediaDoc[]): Promise<MediaView[]> {
    const people = await peopleCards(access, docs.flatMap((d) => [...d.memberIds, ...d.tags.map((t) => t.memberId)]));
    const names = await userNames(docs.map((d) => d.uploadedBy));
    return docs.map((m) => {
      const canEdit = this.canEdit(access, m);
      return {
        id: m.id as string,
        kind: m.kind as MediaKind,
        title: m.title,
        description: m.description,
        mimeType: m.mimeType,
        byteSize: m.byteSize,
        width: m.width ?? null,
        height: m.height ?? null,
        date: toFuzzyDate(m.date),
        privacy: m.privacy as ArchivePrivacy,
        provenance: { source: m.provenance?.source ?? '', citation: m.provenance?.citation ?? '', originalHolder: m.provenance?.originalHolder ?? '' },
        status: m.status as ArchiveStatus,
        people: m.memberIds.map((id) => people.get(id.toString())).filter((p): p is PersonCard => !!p),
        eventId: m.eventId?.toString() ?? null,
        uploadedBy: access.membership ? { id: m.uploadedBy.toString(), displayName: names.get(m.uploadedBy.toString()) ?? 'Former member' } : null,
        createdAt: m.createdAt.toISOString(),
        urls: {
          original: mediaContentPath(access.familyId, m._id, 'original'),
          thumb: m.thumbKey ? mediaContentPath(access.familyId, m._id, 'thumb') : null,
          download: mediaContentPath(access.familyId, m._id, 'download'),
        },
        viewerCan: { edit: canEdit, delete: canEdit, setAsProfilePhoto: m.kind === 'photo' && m.status === 'published' && m.privacy !== 'admins' && !!access.membership },
        // Tags of people the viewer may not see (or who were removed) are left out entirely.
        tags: m.tags.flatMap((t) => {
          const person = people.get(t.memberId.toString());
          return person && t.box ? [{ person, box: { x: t.box.x!, y: t.box.y!, w: t.box.w!, h: t.box.h! } }] : [];
        }),
        transcript:
          m.kind === 'audio' || m.kind === 'video'
            ? {
                status: (m.transcript?.status ?? 'none') as TranscriptStatus,
                text: m.transcript?.text ?? '',
                language: m.transcript?.language ?? '',
                source: (m.transcript?.source as 'typed' | 'automatic' | null) ?? null,
                translation: m.transcript?.translation?.text ? { text: m.transcript.translation.text, language: m.transcript.translation.language ?? '' } : null,
                error: canEdit ? (m.transcript?.error ?? null) : null,
                updatedAt: m.transcript?.updatedAt ? m.transcript.updatedAt.toISOString() : null,
              }
            : null,
        version: m.get('version') as number,
      };
    });
  }

  async view(access: FamilyAccess, id: Types.ObjectId): Promise<MediaView> {
    return (await this.toViews(access, [await this.load(access, id)]))[0]!;
  }

  async list(access: FamilyAccess, query: z.output<typeof mediaListQuery>) {
    access.assert('media.view', { isPublic: true });
    const filter: Record<string, unknown> = { ...(await archiveVisibility(access, 'uploadedBy')), ...searchFilter(query.q) };
    if (query.kind) filter['kind'] = query.kind;
    if (query.memberId) filter['memberIds'] = new Types.ObjectId(query.memberId);
    if (query.eventId) filter['eventId'] = new Types.ObjectId(query.eventId);
    if (query.status) filter['status'] = query.status;
    const [rows, total] = await Promise.all([
      FamilyMediaModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize),
      FamilyMediaModel.countDocuments(filter),
    ]);
    return { data: await this.toViews(access, rows), meta: pageMeta(query, total) };
  }

  /** This build has no family events to attach files to. */
  private async assertEvent(_access: FamilyAccess, eventId: string | null | undefined): Promise<Types.ObjectId | null> {
    if (!eventId) return null;
    throw new AppError('VALIDATION_FAILED', 'Files cannot be attached to events', [{ path: 'eventId', message: 'Unknown event' }]);
  }

  async upload(access: FamilyAccess, actor: Actor, req: Request): Promise<MediaView> {
    const mode = this.uploadMode(access);
    const upload = await receiveUpload(req, this.maxBytes);
    const stored: string[] = [];
    try {
      const fields = parse(uploadFields, upload.fields);
      const profileOf = fields.profileOf ? new Types.ObjectId(fields.profileOf) : null;
      if (profileOf) await this.checkProfileOf(access, mode, profileOf, fields.privacy);
      const memberIds = await assertPeople(access, profileOf ? [...(fields.memberIds ?? []), profileOf.toString()] : fields.memberIds);
      const eventId = await this.assertEvent(access, fields.eventId);
      const type = await sniff(upload.file.path);
      if (profileOf && type.kind !== 'photo') {
        throw new AppError('VALIDATION_FAILED', 'A profile photo must be a picture', [{ path: 'file', message: 'Choose a JPEG, PNG or WebP picture' }]);
      }

      const duplicate = await FamilyMediaModel.findOne({ familyId: access.familyId, sha256: upload.file.sha256, deletedAt: null, status: { $ne: 'rejected' } }, { title: 1, kind: 1, status: 1, privacy: 1, memberIds: 1 }).lean();
      if (duplicate && profileOf && mode === 'direct' && duplicate.kind === 'photo' && duplicate.status === 'published' && duplicate.privacy !== 'admins') {
        // The same picture again (chosen twice, or for a second person): use the copy already in the archive.
        if (!duplicate.memberIds.some((id) => id.equals(profileOf))) await FamilyMediaModel.updateOne({ _id: duplicate._id }, { $addToSet: { memberIds: profileOf } });
        await this.profiles!.setProfilePhoto(access, actor, profileOf, duplicate._id);
        return this.view(access, duplicate._id);
      }
      if (duplicate) {
        throw new AppError('CONFLICT', `This file is already in the family archive as “${duplicate.title}”.`, [{ path: 'file', message: `duplicate:${duplicate._id.toString()}` }]);
      }

      const id = new Types.ObjectId();
      const prefix = `families/${access.familyId.toString()}/media/${id.toString()}`;
      let file = { path: upload.file.path, mime: type.mime, ext: type.ext };
      let dims: { width?: number; height?: number } = {};
      let thumbKey: string | null = null;
      if (type.kind === 'photo') {
        const image = await processImage(upload.file.path, type.mime);
        file = { path: image.original.path, mime: image.original.mime, ext: image.original.ext };
        dims = { width: image.original.width, height: image.original.height };
        thumbKey = `${prefix}/thumb.webp`;
        await this.storage.putFile(thumbKey, image.thumb.path, image.thumb.mime);
        stored.push(thumbKey);
      }
      const storageKey = `${prefix}/original.${EXTENSIONS[file.mime] ?? file.ext}`;
      await this.storage.putFile(storageKey, file.path, file.mime);
      stored.push(storageKey);

      const originalName = upload.file.originalName.slice(0, 255);
      const title = fields.title || originalName.replace(/\.[^.]{1,8}$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 200) || 'Untitled';
      const { size } = await stat(file.path);
      const doc = await FamilyMediaModel.create({
        _id: id,
        familyId: access.familyId,
        kind: type.kind,
        title,
        description: fields.description ?? '',
        storageKey,
        thumbKey,
        originalName,
        mimeType: file.mime,
        byteSize: size,
        sha256: upload.file.sha256,
        ...dims,
        memberIds,
        eventId,
        date: fields.date ?? null,
        privacy: fields.privacy ?? 'family',
        provenance: fields.provenance ?? {},
        uploadedBy: actor.userId,
        status: mode === 'direct' ? 'published' : 'pending_approval',
        searchText: searchTextOf(title, fields.description, originalName),
      });
      await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'media.upload', targetType: 'media', targetId: doc._id, after: { title, kind: type.kind, byteSize: size, status: doc.status }, requestId: actor.requestId, ip: actor.ip });
      if (mode === 'review') {
        await this.review!.fileArchiveItem(access, actor, { kind: 'media.attach', targetType: 'media', targetId: doc._id, memberIds, note: fields.note, profileOf: profileOf ?? undefined });
      } else if (profileOf) {
        try {
          await this.profiles!.setProfilePhoto(access, actor, profileOf, doc._id);
        } catch (err) {
          await FamilyMediaModel.deleteOne({ _id: doc._id });
          throw err;
        }
      }
      return (await this.toViews(access, [doc]))[0]!;
    } catch (err) {
      await Promise.all(stored.map((k) => this.storage.remove(k).catch(() => undefined)));
      throw err;
    } finally {
      await upload.cleanup();
    }
  }

  /** A photo uploaded as someone's profile photo: the viewer must be able to set it now, or to suggest it for review. */
  private async checkProfileOf(access: FamilyAccess, mode: 'direct' | 'review', id: Types.ObjectId, privacy: ArchivePrivacy | undefined): Promise<void> {
    if (!this.profiles) throw new Error('Profile photos are not set up');
    if (privacy === 'admins') {
      throw new AppError('VALIDATION_FAILED', 'A profile photo must be visible to the family', [{ path: 'privacy', message: 'Choose who can see it' }]);
    }
    if (!(await FamilyMemberModel.exists({ _id: id, familyId: access.familyId, deletedAt: null }))) throw AppError.notFound('Person');
    const allowed = await this.profiles.profilePhotoMode(access, id);
    if (!allowed || (mode === 'direct' && allowed !== 'direct')) throw AppError.forbidden("You cannot change this person's profile photo.");
  }

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: z.output<typeof updateMediaBody>): Promise<MediaView> {
    const m = await this.load(access, id);
    if (!this.canEdit(access, m)) throw AppError.forbidden();
    if ((m.get('version') as number) !== patch.version) throw new AppError('VERSION_CONFLICT', 'This file was changed by someone else. Reload and try again.');
    const before = m.toObject();
    if (patch.title !== undefined) m.title = patch.title;
    if (patch.description !== undefined) m.description = patch.description;
    if (patch.date !== undefined) m.set('date', patch.date);
    if (patch.memberIds !== undefined) m.memberIds = await assertPeople(access, patch.memberIds);
    if (patch.eventId !== undefined) m.eventId = await this.assertEvent(access, patch.eventId);
    if (patch.privacy !== undefined) m.privacy = patch.privacy;
    if (patch.provenance !== undefined) m.set('provenance', { ...(m.provenance ?? {}), ...patch.provenance });
    m.searchText = mediaSearchText(m);
    await m.save();
    if (m.privacy === 'admins') await this.unsetProfilePhotos(access, m._id);
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'media.update', targetType: 'media', targetId: m._id, before, after: m.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.view(access, m._id);
  }

  private async editable(access: FamilyAccess, id: Types.ObjectId, version: number): Promise<FamilyMediaDoc> {
    const m = await this.load(access, id);
    if (!this.canEdit(access, m)) throw AppError.forbidden();
    if ((m.get('version') as number) !== version) throw new AppError('VERSION_CONFLICT', 'This file was changed by someone else. Reload and try again.');
    return m;
  }

  /** Who is in a photo, and where. Tagged people are also listed among the file's people. */
  async setTags(access: FamilyAccess, actor: Actor, id: Types.ObjectId, body: z.output<typeof tagsBody>): Promise<MediaView> {
    const m = await this.editable(access, id, body.version);
    if (m.kind !== 'photo') throw new AppError('VALIDATION_FAILED', 'Only photos can have people tagged in them', [{ path: 'tags', message: 'Not a photo' }]);
    const before = m.tags.map((t) => ({ memberId: t.memberId, box: t.box }));
    // One box per person.
    const byPerson = new Map(body.tags.map((t) => [t.memberId, t]));
    const ids = await assertPeople(access, [...byPerson.keys()]);
    // Boxes around people the editor cannot see (or who were removed, and may be restored) are kept as they are.
    const visible = await peopleCards(access, m.tags.map((t) => t.memberId));
    const kept = m.tags.filter((t) => !visible.has(t.memberId.toString()) && !byPerson.has(t.memberId.toString())).map((t) => ({ memberId: t.memberId, box: t.box }));
    m.set('tags', [...kept, ...ids.map((memberId) => ({ memberId, box: byPerson.get(memberId.toString())!.box }))]);
    const people = new Set(m.memberIds.map(String));
    for (const memberId of ids) if (!people.has(memberId.toString())) m.memberIds.push(memberId);
    await m.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'media.tags', targetType: 'media', targetId: m._id, before: { tags: before }, after: { tags: m.tags }, requestId: actor.requestId, ip: actor.ip });
    return this.view(access, m._id);
  }

  /** A transcript typed (or corrected) by hand. An empty text removes the transcript. */
  async setTranscript(access: FamilyAccess, actor: Actor, id: Types.ObjectId, body: z.output<typeof transcriptBody>): Promise<MediaView> {
    const m = await this.editable(access, id, body.version);
    if (m.kind !== 'audio' && m.kind !== 'video') throw new AppError('VALIDATION_FAILED', 'Only recordings and videos have transcripts', [{ path: 'text', message: 'Not a recording' }]);
    const before = m.toObject().transcript;
    const translation = body.translation === undefined ? (m.transcript?.translation ?? null) : body.translation?.text ? body.translation : null;
    m.set('transcript', {
      status: body.text ? 'done' : 'none',
      text: body.text,
      language: body.language ?? m.transcript?.language ?? '',
      source: body.text ? 'typed' : null,
      translation,
      error: null,
      updatedAt: new Date(),
    });
    m.searchText = mediaSearchText(m);
    await m.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'media.transcript', targetType: 'media', targetId: m._id, before, after: m.toObject().transcript, requestId: actor.requestId, ip: actor.ip });
    return this.view(access, m._id);
  }

  /** Asks the speech-to-text service for a transcript (and optionally an English translation). */
  async transcribe(access: FamilyAccess, actor: Actor, id: Types.ObjectId, body: z.output<typeof transcribeBody>): Promise<MediaView> {
    const m = await this.load(access, id);
    if (!this.canEdit(access, m)) throw AppError.forbidden();
    const t = this.transcription;
    if (!t?.transcriber.enabled) throw new AppError('CONFLICT', 'Automatic transcription is not set up on this server. You can type the transcript instead.');
    if (m.kind !== 'audio' && m.kind !== 'video') throw new AppError('VALIDATION_FAILED', 'Only recordings and videos can be transcribed', [{ path: 'id', message: 'Not a recording' }]);
    if (m.transcript?.status === 'pending') throw new AppError('CONFLICT', 'This recording is already being transcribed');
    if (m.byteSize > t.transcriber.maxBytes) throw new AppError('PAYLOAD_TOO_LARGE', `Recordings up to ${Math.round(t.transcriber.maxBytes / 1024 / 1024)} MB can be transcribed automatically. Type the transcript instead, or upload a shorter recording.`);
    if (m.transcript?.source === 'typed' && m.transcript.text) throw new AppError('CONFLICT', 'This recording already has a typed transcript. Clear it first to transcribe automatically.');
    await FamilyMediaModel.updateOne({ _id: m._id }, { $set: { 'transcript.status': 'pending', 'transcript.error': null, 'transcript.updatedAt': new Date() } });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'media.transcribe_request', targetType: 'media', targetId: m._id, after: { translate: body.translate }, requestId: actor.requestId, ip: actor.ip });
    await t.request({ mediaId: m.id as string, translate: body.translate });
    return this.view(access, m._id);
  }

  /** Soft delete: the record disappears at once (no new links are issued); the stored file is kept for restore. */
  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    const m = await this.load(access, id);
    if (!this.canEdit(access, m)) throw AppError.forbidden();
    m.deletedAt = new Date();
    m.deletedBy = actor.userId;
    await m.save();
    await this.unsetProfilePhotos(access, m._id);
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'media.delete', targetType: 'media', targetId: m._id, before: { title: m.title, kind: m.kind }, requestId: actor.requestId, ip: actor.ip });
  }

  private async unsetProfilePhotos(access: FamilyAccess, mediaId: Types.ObjectId): Promise<void> {
    await FamilyMemberModel.updateMany({ familyId: access.familyId, profilePhotoMediaId: mediaId }, { $set: { profilePhotoMediaId: null } });
  }

  /** Signed link to the file, after checking the viewer may see it. */
  async contentUrl(access: FamilyAccess, id: Types.ObjectId, options: { thumb: boolean; download: boolean }): Promise<string> {
    access.assert('media.view', { isPublic: true });
    const m = await this.load(access, id);
    const key = options.thumb ? m.thumbKey : m.storageKey;
    if (!key) throw AppError.notFound('Preview');
    const ext = key.slice(key.lastIndexOf('.'));
    const base = m.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'file';
    return this.storage.signedUrl(key, {
      contentType: options.thumb ? 'image/webp' : m.mimeType,
      disposition: options.download ? 'attachment' : 'inline',
      filename: base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`,
    });
  }

  // ------------------------------------------------------------------ trash

  /** Removed files that can still be restored (until the purge erases them). */
  async listRemoved(access: FamilyAccess): Promise<(MediaView & { deletedAt: string })[]> {
    access.assert('record.restore');
    const rows = await FamilyMediaModel.find({ familyId: access.familyId, deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).limit(200);
    const views = await this.toViews(access, rows);
    return views.map((v, i) => ({ ...v, deletedAt: rows[i]!.deletedAt!.toISOString() }));
  }

  async restore(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<MediaView> {
    access.assert('record.restore');
    const m = await FamilyMediaModel.findOne({ _id: id, familyId: access.familyId, deletedAt: { $ne: null } });
    if (!m) throw AppError.notFound('Removed file');
    m.deletedAt = null;
    m.deletedBy = null;
    await m.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'media.restore', targetType: 'media', targetId: m._id, after: { title: m.title }, requestId: actor.requestId, ip: actor.ip });
    return this.view(access, m._id);
  }

  // ------------------------------------------------------------------ review hooks

  async loadAny(access: FamilyAccess, id: Types.ObjectId | null | undefined): Promise<FamilyMediaDoc | null> {
    return id ? FamilyMediaModel.findOne({ _id: id, familyId: access.familyId }) : null;
  }

  async setStatus(access: FamilyAccess, actor: Actor, id: Types.ObjectId, status: 'published' | 'rejected', contributionId: Types.ObjectId): Promise<void> {
    const m = await FamilyMediaModel.findOne({ _id: id, familyId: access.familyId, deletedAt: null });
    if (!m) throw new AppError('CONFLICT', 'The file has been removed in the meantime.');
    m.status = status;
    await m.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: status === 'published' ? 'media.publish' : 'media.reject', targetType: 'media', targetId: m._id, after: { status, title: m.title }, contributionId, requestId: actor.requestId, ip: actor.ip });
  }
}
