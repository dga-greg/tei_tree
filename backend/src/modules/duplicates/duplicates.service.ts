import mongoose, { Types, type ClientSession, type Model } from 'mongoose';
import { z } from 'zod';
import { MERGE_FIELDS, displayName, type DuplicatePair, type MergeView } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { isClearlyAfter } from '../../core/fuzzy-date.js';
import { objectId } from '../../core/validation.js';
import type { AuditService } from '../audit/audit.service.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import { FamilyContributionModel } from '../contributions/contribution.model.js';
import { FamilyEventModel } from '../events/event.model.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyModel } from '../families/family.model.js';
import type { FamiliesService } from '../families/families.service.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { FamilyInvitationModel } from '../invitations/invitation.model.js';
import { FamilyMediaModel } from '../media/media.model.js';
import { FamilyMemberModel, type FamilyMemberDoc } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { searchFields } from '../members/members.service.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { noGraphListener, type Actor, type GraphChangeListener } from '../relationships/relationships.service.js';
import { FamilyStoryModel } from '../stories/story.model.js';
import { UserModel } from '../users/user.model.js';
import { DuplicateDismissalModel, MemberMergeModel } from './duplicates.model.js';
import { blockingKeys, scoreMatch, type MatchCandidate } from './match.js';

const live = { deletedAt: null };
const MAX_PAIRS = 200;
/** Very common first names are compared within groups of at most this many people. */
const MAX_GROUP = 3000;

export const duplicatesQuery = z.object({ limit: z.coerce.number().int().min(1).max(MAX_PAIRS).default(100) }).strict();
export const dismissBody = z.object({ a: objectId, b: objectId }).strict();
export const mergeBody = z
  .object({
    otherId: objectId,
    choices: z.partialRecord(z.enum(MERGE_FIELDS), z.enum(['keep', 'other'])).default({}),
    keepVersion: z.number().int().min(0),
    otherVersion: z.number().int().min(0),
  })
  .strict();

const pair = (a: Types.ObjectId | string, b: Types.ObjectId | string) => {
  const [x, y] = [String(a), String(b)].sort();
  return { a: new Types.ObjectId(x), b: new Types.ObjectId(y), key: `${x}|${y}` };
};

/** List fields combined on merge, with how two entries are recognised as the same. */
const LIST_FIELDS: { field: string; key: (v: Record<string, unknown> | string) => string }[] = [
  { field: 'previousNames', key: (v) => String(v).toLowerCase() },
  { field: 'achievements', key: (v) => String(v).toLowerCase() },
  { field: 'education', key: (v) => JSON.stringify([(v as Record<string, unknown>)['title'], (v as Record<string, unknown>)['organisation'] ?? null]).toLowerCase() },
  { field: 'occupations', key: (v) => JSON.stringify([(v as Record<string, unknown>)['title'], (v as Record<string, unknown>)['organisation'] ?? null]).toLowerCase() },
  { field: 'sources', key: (v) => JSON.stringify([(v as Record<string, unknown>)['title'], (v as Record<string, unknown>)['citation'] ?? null]).toLowerCase() },
];

const PRIVACY_ORDER = ['public', 'family', 'restricted'];

/** Copy of a stored list without Mongoose sub-document ids. */
function plainList(value: unknown): unknown[] {
  return ((value as unknown[]) ?? []).map((v) => {
    if (v && typeof v === 'object') {
      const { _id: _ignored, ...rest } = v as Record<string, unknown>;
      return rest;
    }
    return v;
  });
}

export class DuplicatesService {
  constructor(
    private readonly audit: AuditService,
    private readonly families: FamiliesService,
    private readonly graph: GraphChangeListener = noGraphListener,
  ) {}

  // ------------------------------------------------------------------ finding

  async list(access: FamilyAccess, query: z.output<typeof duplicatesQuery>): Promise<DuplicatePair[]> {
    access.assert('member.merge');
    const policy = new MemberPolicy(access);
    const [people, edges, dismissals] = await Promise.all([
      FamilyMemberModel.find({ familyId: access.familyId, ...live }),
      RelationshipModel.find({ familyId: access.familyId, ...live }, { type: 1, personA: 1, personB: 1 }).lean(),
      DuplicateDismissalModel.find({ familyId: access.familyId }, { a: 1, b: 1 }).lean(),
    ]);
    const linked = new Set(edges.map((e) => pair(e.personA, e.personB).key));
    const dismissed = new Set(dismissals.map((d) => pair(d.a, d.b).key));
    const parents = new Map<string, Set<string>>();
    for (const e of edges) {
      if (e.type !== 'parent_child') continue;
      const child = e.personB.toString();
      parents.set(child, (parents.get(child) ?? new Set()).add(e.personA.toString()));
    }

    const groups = new Map<string, FamilyMemberDoc[]>();
    for (const p of people) for (const key of blockingKeys(p as unknown as MatchCandidate)) groups.set(key, [...(groups.get(key) ?? []), p]);

    const found = new Map<string, DuplicatePair>();
    for (const group of groups.values()) {
      const members = group.slice(0, MAX_GROUP);
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const x = members[i]!;
          const y = members[j]!;
          const { key } = pair(x._id, y._id);
          if (found.has(key) || linked.has(key) || dismissed.has(key)) continue;
          const result = scoreMatch(x as unknown as MatchCandidate, y as unknown as MatchCandidate);
          if (!result) continue;
          const px = parents.get(x.id as string);
          const py = parents.get(y.id as string);
          let { score } = result;
          const reasons = [...result.reasons];
          if (px && py && [...px].some((p) => py.has(p))) {
            // Same first name and same parent is usually one child recorded twice, unless born years apart (scored above).
            score = Math.min(100, score + 10);
            reasons.push('Same parent');
          }
          found.set(key, { a: toPersonCard(x, policy), b: toPersonCard(y, policy), score, strength: score >= 80 ? 'strong' : 'possible', reasons });
        }
      }
    }
    return [...found.values()].sort((p, q) => q.score - p.score || p.a.displayName.localeCompare(q.a.displayName)).slice(0, query.limit);
  }

  async dismiss(access: FamilyAccess, actor: Actor, body: z.output<typeof dismissBody>): Promise<void> {
    access.assert('member.merge');
    const { a, b } = pair(body.a, body.b);
    if (a.equals(b)) throw new AppError('VALIDATION_FAILED', 'Choose two different people', [{ path: 'b', message: 'Same person' }]);
    const count = await FamilyMemberModel.countDocuments({ _id: { $in: [a, b] }, familyId: access.familyId, ...live });
    if (count !== 2) throw AppError.notFound('Person');
    await DuplicateDismissalModel.updateOne({ familyId: access.familyId, a, b }, { $setOnInsert: { createdBy: actor.userId } }, { upsert: true });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'duplicate.dismiss', targetType: 'member', targetId: a, after: { a, b }, requestId: actor.requestId, ip: actor.ip });
  }

  // ------------------------------------------------------------------ merging

  private async load(access: FamilyAccess, id: Types.ObjectId, session: ClientSession): Promise<FamilyMemberDoc> {
    const doc = await FamilyMemberModel.findOne({ _id: id, familyId: access.familyId, ...live }).select('+contact').session(session);
    if (!doc) throw AppError.notFound('Person');
    return doc;
  }

  /** Replaces `other` with `keep` in the people tagged on archive items; where both are tagged, `other` is only removed. */
  private async moveTags(model: Model<never>, familyId: Types.ObjectId, keep: Types.ObjectId, other: Types.ObjectId, session: ClientSession) {
    const both = await model.find({ familyId, memberIds: { $all: [keep, other] } } as never, { _id: 1 }).session(session).lean<{ _id: Types.ObjectId }[]>();
    const only = await model.find({ familyId, memberIds: other, _id: { $nin: both.map((d) => d._id) } } as never, { _id: 1 }).session(session).lean<{ _id: Types.ObjectId }[]>();
    if (both.length) await model.updateMany({ _id: { $in: both.map((d) => d._id) } } as never, { $pull: { memberIds: other } } as never, { session });
    if (only.length) await model.updateMany({ _id: { $in: only.map((d) => d._id) } } as never, { $set: { 'memberIds.$[x]': keep } } as never, { session, arrayFilters: [{ x: other }] });
    return { replaced: only.map((d) => d._id), pulled: both.map((d) => d._id) };
  }

  /** Photo tags: the other person's box becomes the kept person's, unless the kept person is already tagged in that photo. */
  private async movePhotoTags(familyId: Types.ObjectId, keep: Types.ObjectId, other: Types.ObjectId, session: ClientSession) {
    const photos = await FamilyMediaModel.find({ familyId, 'tags.memberId': other }, { tags: 1 }).session(session);
    const changes: { mediaId: Types.ObjectId; change: 'moved' | 'removed'; box: unknown }[] = [];
    for (const p of photos) {
      const tag = p.tags.find((t) => t.memberId.equals(other))!;
      const box = { x: tag.box?.x, y: tag.box?.y, w: tag.box?.w, h: tag.box?.h };
      if (p.tags.some((t) => t.memberId.equals(keep))) {
        await FamilyMediaModel.updateOne({ _id: p._id }, { $pull: { tags: { memberId: other } } }, { session });
        changes.push({ mediaId: p._id, change: 'removed', box });
      } else {
        await FamilyMediaModel.updateOne({ _id: p._id }, { $set: { 'tags.$[x].memberId': keep } }, { session, arrayFilters: [{ 'x.memberId': other }] });
        changes.push({ mediaId: p._id, change: 'moved', box });
      }
    }
    return changes;
  }

  /** Throws when the kept person's links break an integrity rule after the merge. */
  private async checkGraph(familyId: Types.ObjectId, keep: Types.ObjectId, name: string, session: ClientSession): Promise<void> {
    const mine = await RelationshipModel.find({ familyId, ...live, $or: [{ personA: keep }, { personB: keep }] }).session(session);
    const birthParents = mine.filter((e) => e.type === 'parent_child' && e.personB.equals(keep) && e.subtype === 'biological').length;
    if (birthParents > 2) {
      throw new AppError('CONFLICT', `Together they would have ${birthParents} birth parents. Change the extra parent links to adoptive, step, foster or guardian first.`);
    }
    const others = (e: (typeof mine)[number]) => (e.personA.equals(keep) ? e.personB : e.personA).toString();
    const parentSide = new Set(mine.filter((e) => e.type === 'parent_child').map(others));
    if (mine.some((e) => e.type === 'partnership' && parentSide.has(others(e)))) {
      throw new AppError('CONFLICT', `After the merge, ${name} would be both parent or child and partner of the same person. Fix those links first.`);
    }
    // Own ancestor: walk down from the kept person's children.
    const edges = await RelationshipModel.find({ familyId, type: 'parent_child', ...live }, { personA: 1, personB: 1 }).session(session).lean();
    const down = new Map<string, string[]>();
    for (const e of edges) down.set(e.personA.toString(), [...(down.get(e.personA.toString()) ?? []), e.personB.toString()]);
    const target = keep.toString();
    const stack = [...(down.get(target) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const n = stack.pop()!;
      if (n === target) throw new AppError('CONFLICT', `After the merge, ${name} would be their own ancestor. One of them is recorded as an ancestor of the other; fix that link first.`);
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(down.get(n) ?? []));
    }
  }

  async merge(access: FamilyAccess, actor: Actor, keepId: Types.ObjectId, body: z.output<typeof mergeBody>): Promise<MergeView> {
    access.assert('member.merge');
    const otherId = new Types.ObjectId(String(body.otherId));
    if (keepId.equals(otherId)) throw new AppError('VALIDATION_FAILED', 'Choose two different people', [{ path: 'otherId', message: 'Same person' }]);
    const familyId = access.familyId;

    const merge = await mongoose.connection.transaction(async (session) => {
      await FamilyModel.updateOne({ _id: familyId }, { $inc: { graphRevision: 1 } }, { session });
      const keep = await this.load(access, keepId, session);
      const other = await this.load(access, otherId, session);
      if ((keep.get('version') as number) !== body.keepVersion || (other.get('version') as number) !== body.otherVersion) {
        throw new AppError('VERSION_CONFLICT', 'One of these people was changed by someone else. Reload and compare them again.');
      }
      const keepBefore = keep.toObject();
      const otherPlain = other.toObject() as Record<string, unknown>;
      const otherName = displayName(other);

      // Accounts linked to the profiles.
      const claims = await FamilyMembershipModel.find({ familyId, memberProfileId: { $in: [keepId, otherId] }, status: 'active' }).session(session);
      if (claims.length > 1) throw new AppError('CONFLICT', 'Both profiles are claimed by family members. Unlink one of the accounts before merging.');
      const otherClaim = claims.find((c) => c.memberProfileId?.equals(otherId));
      if (otherClaim) {
        otherClaim.memberProfileId = keepId;
        await otherClaim.save({ session });
      }

      // Details chosen field by field.
      for (const field of MERGE_FIELDS) {
        if (body.choices[field] !== 'other') continue;
        const value = otherPlain[field];
        keep.set(field, value === undefined ? (field === 'gender' ? undefined : null) : value);
      }
      for (const { field, key } of LIST_FIELDS) {
        const mine = plainList(keep.get(field));
        const seen = new Set(mine.map((v) => key(v as never)));
        for (const v of plainList(otherPlain[field])) if (!seen.has(key(v as never))) mine.push(v), seen.add(key(v as never));
        keep.set(field, mine);
      }
      // The name that is not kept is remembered as a previous name.
      const names = new Set((keep.get('previousNames') as string[]).map((n) => n.toLowerCase()));
      for (const name of [[other.firstName, other.middleNames, other.surname].filter(Boolean).join(' '), [keepBefore.firstName, keepBefore.middleNames, keepBefore.surname].filter(Boolean).join(' ')]) {
        const current = [keep.firstName, keep.middleNames, keep.surname].filter(Boolean).join(' ');
        if (name && name.toLowerCase() !== current.toLowerCase() && !names.has(name.toLowerCase())) {
          keep.set('previousNames', [...(keep.get('previousNames') as string[]), name]);
          names.add(name.toLowerCase());
        }
      }
      if (!keep.get('biography') && other.biography) keep.set('biography', other.biography);
      if (!keep.get('contact') && otherPlain['contact']) keep.set('contact', otherPlain['contact']);
      // The stricter privacy setting of the two applies.
      const level = [keep.privacy?.level ?? 'family', other.privacy?.level ?? 'family'].sort((a, b) => PRIVACY_ORDER.indexOf(b) - PRIVACY_ORDER.indexOf(a))[0]!;
      keep.set('privacy.level', level);
      keep.set('privacy.hideDates', !!(keep.privacy?.hideDates || other.privacy?.hideDates));
      const merged = keep.toObject();
      if (merged.vitalStatus === 'living' && (merged.deathDate?.year || merged.deathDate?.text || merged.deathPlace)) {
        throw new AppError('VALIDATION_FAILED', 'The merged person would be living with a date or place of death. Choose the life status or death details from the same person.', [{ path: 'vitalStatus', message: 'Inconsistent with death details' }]);
      }
      if (isClearlyAfter(merged.birthDate as never, merged.deathDate as never)) {
        throw new AppError('VALIDATION_FAILED', 'The chosen date of death is before the chosen date of birth', [{ path: 'deathDate', message: 'Must be after the date of birth' }]);
      }
      if (merged.privacy?.level === 'public' && merged.vitalStatus !== 'deceased') keep.set('privacy.level', 'family');
      keep.set(searchFields(keep.toObject()));
      keep.updatedBy = actor.userId;

      // Links: moved to the kept person, or removed when they would repeat one of theirs or join the two.
      const theirs = await RelationshipModel.find({ familyId, ...live, $or: [{ personA: otherId }, { personB: otherId }] }).session(session);
      const keepEdges = await RelationshipModel.find({ familyId, ...live, $or: [{ personA: keepId }, { personB: keepId }] }).session(session);
      const existing = new Set(keepEdges.map((e) => `${e.type}|${e.type === 'partnership' ? pair(e.personA, e.personB).key : `${e.personA}|${e.personB}`}`));
      const at = new Date();
      const links: { edgeId: Types.ObjectId; change: 'moved' | 'removed'; personA: Types.ObjectId; personB: Types.ObjectId }[] = [];
      for (const e of theirs) {
        const before = { personA: e.personA, personB: e.personB };
        const a = e.personA.equals(otherId) ? keepId : e.personA;
        const b = e.personB.equals(otherId) ? keepId : e.personB;
        const key = `${e.type}|${e.type === 'partnership' ? pair(a, b).key : `${a}|${b}`}`;
        if (a.equals(b) || existing.has(key)) {
          e.deletedAt = at;
          e.deletedBy = actor.userId;
          await e.save({ session });
          links.push({ edgeId: e._id, change: 'removed', ...before });
          continue;
        }
        const next = e.type === 'partnership' ? pair(a, b) : { a, b };
        e.personA = next.a;
        e.personB = next.b;
        e.updatedBy = actor.userId;
        await e.save({ session });
        existing.add(key);
        links.push({ edgeId: e._id, change: 'moved', ...before });
      }
      await this.checkGraph(familyId, keepId, displayName(keep), session);

      // Everything else that points at the person.
      const media = await this.moveTags(FamilyMediaModel as never, familyId, keepId, otherId, session);
      const photoTags = await this.movePhotoTags(familyId, keepId, otherId, session);
      const stories = await this.moveTags(FamilyStoryModel as never, familyId, keepId, otherId, session);
      const events = await this.moveTags(FamilyEventModel as never, familyId, keepId, otherId, session);
      let founderMoved = false;
      if (access.family.foundingMemberId?.equals(otherId)) {
        await FamilyModel.updateOne({ _id: familyId }, { $set: { foundingMemberId: keepId } }, { session });
        founderMoved = true;
      }
      const branches = await FamilyBranchModel.find({ familyId, foundingMemberId: otherId, ...live }).session(session);
      if (branches.length && (await FamilyBranchModel.exists({ familyId, foundingMemberId: keepId, ...live }).session(session))) {
        throw new AppError('CONFLICT', 'Both people start a family branch. Remove one of the branches before merging.');
      }
      if (branches.length) await FamilyBranchModel.updateMany({ _id: { $in: branches.map((b) => b._id) } }, { $set: { foundingMemberId: keepId } }, { session });
      const invitations = await FamilyInvitationModel.find({ familyId, suggestedProfileId: otherId, status: 'pending' }, { _id: 1 }).session(session).lean();
      if (invitations.length) await FamilyInvitationModel.updateMany({ _id: { $in: invitations.map((i) => i._id) } }, { $set: { suggestedProfileId: keepId } }, { session });
      const contributions = await FamilyContributionModel.find({ familyId, targetType: 'member', targetId: otherId, status: { $in: ['pending', 'needs_clarification'] } }, { _id: 1 }).session(session).lean();
      if (contributions.length) await FamilyContributionModel.updateMany({ _id: { $in: contributions.map((c) => c._id) } }, { $set: { targetId: keepId } }, { session });

      await keep.save({ session });
      other.deletedAt = at;
      other.deletedBy = actor.userId;
      other.set('mergedInto', keepId);
      await other.save({ session });

      const [record] = await MemberMergeModel.create(
        [
          {
            familyId,
            keepId,
            otherId,
            otherName,
            keepBefore,
            keepVersionAfter: keep.get('version') as number,
            links,
            replaced: { media: media.replaced, stories: stories.replaced, events: events.replaced },
            pulled: { media: media.pulled, stories: stories.pulled, events: events.pulled },
            photoTags,
            membershipId: otherClaim?._id ?? null,
            founderMoved,
            branchIds: branches.map((b) => b._id),
            invitationIds: invitations.map((i) => i._id),
            contributionIds: contributions.map((c) => c._id),
            removedAt: at,
            createdBy: actor.userId,
          },
        ],
        { session },
      );
      await this.audit.record(
        { familyId, actorId: actor.userId, actorRole: access.role, action: 'member.merge', targetType: 'member', targetId: keepId, before: keepBefore, after: { ...keep.toObject(), mergedFrom: { id: otherId, name: otherName } }, requestId: actor.requestId, ip: actor.ip },
        session,
      );
      await this.families.refreshStats(familyId, session);
      return record!;
    });
    await this.graph.request(familyId);
    return this.toView(access, merge);
  }

  async listMerges(access: FamilyAccess): Promise<MergeView[]> {
    access.assert('member.merge');
    const merges = await MemberMergeModel.find({ familyId: access.familyId }).sort({ createdAt: -1 }).limit(50);
    return Promise.all(merges.map((m) => this.toView(access, m)));
  }

  /** Separates the two people again, provided the kept person has not been changed since the merge. */
  async undoMerge(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<MergeView> {
    access.assert('member.merge');
    const familyId = access.familyId;
    const merge = await mongoose.connection.transaction(async (session) => {
      const m = await MemberMergeModel.findOne({ _id: id, familyId }).session(session);
      if (!m) throw AppError.notFound('Merge');
      if (m.status !== 'active') throw new AppError('CONFLICT', 'This merge has already been undone');
      await FamilyModel.updateOne({ _id: familyId }, { $inc: { graphRevision: 1 } }, { session });
      const keep = await FamilyMemberModel.findOne({ _id: m.keepId, familyId, ...live }).select('+contact').session(session);
      const other = await FamilyMemberModel.findOne({ _id: m.otherId, familyId, mergedInto: m.keepId }).session(session);
      if (!keep || !other) throw new AppError('CONFLICT', 'One of the two people has been removed since the merge, so it cannot be undone.');
      if ((keep.get('version') as number) !== m.keepVersionAfter) {
        throw new AppError('CONFLICT', `${displayName(keep)} has been changed since the merge, so it can no longer be undone automatically.`);
      }

      const before = m.keepBefore as Record<string, unknown>;
      const restorable = [...MERGE_FIELDS, ...LIST_FIELDS.map((f) => f.field), 'privacy', 'contact', 'searchTokens', 'phoneticKeys'];
      for (const field of restorable) keep.set(field, before[field] ?? (field === 'gender' || field === 'contact' ? undefined : null));
      keep.updatedBy = actor.userId;

      for (const l of [...m.links].reverse()) {
        const edge = await RelationshipModel.findOne({ _id: l.edgeId, familyId }).session(session);
        if (!edge) continue;
        if (l.change === 'removed') {
          if (edge.deletedAt?.getTime() !== m.removedAt.getTime()) continue;
          edge.deletedAt = null;
          edge.deletedBy = null;
        } else {
          if (edge.deletedAt) continue;
          edge.personA = l.personA;
          edge.personB = l.personB;
          edge.updatedBy = actor.userId;
        }
        await edge.save({ session });
      }
      const restoreTags = async (model: Model<never>, replaced: Types.ObjectId[], pulled: Types.ObjectId[]) => {
        if (replaced.length) await model.updateMany({ _id: { $in: replaced }, memberIds: { $ne: m.otherId } } as never, { $set: { 'memberIds.$[x]': m.otherId } } as never, { session, arrayFilters: [{ x: m.keepId }] });
        if (pulled.length) await model.updateMany({ _id: { $in: pulled } } as never, { $addToSet: { memberIds: m.otherId } } as never, { session });
      };
      await restoreTags(FamilyMediaModel as never, m.replaced?.media ?? [], m.pulled?.media ?? []);
      for (const t of m.photoTags ?? []) {
        if (t.change === 'moved') await FamilyMediaModel.updateOne({ _id: t.mediaId, familyId }, { $set: { 'tags.$[x].memberId': m.otherId } }, { session, arrayFilters: [{ 'x.memberId': m.keepId }] });
        else await FamilyMediaModel.updateOne({ _id: t.mediaId, familyId, 'tags.memberId': { $ne: m.otherId } }, { $push: { tags: { memberId: m.otherId, box: t.box } } }, { session });
      }
      await restoreTags(FamilyStoryModel as never, m.replaced?.stories ?? [], m.pulled?.stories ?? []);
      await restoreTags(FamilyEventModel as never, m.replaced?.events ?? [], m.pulled?.events ?? []);
      if (m.membershipId) await FamilyMembershipModel.updateOne({ _id: m.membershipId, memberProfileId: m.keepId }, { $set: { memberProfileId: m.otherId } }, { session });
      if (m.founderMoved) await FamilyModel.updateOne({ _id: familyId, foundingMemberId: m.keepId }, { $set: { foundingMemberId: m.otherId } }, { session });
      if (m.branchIds.length) await FamilyBranchModel.updateMany({ _id: { $in: m.branchIds }, foundingMemberId: m.keepId }, { $set: { foundingMemberId: m.otherId } }, { session });
      if (m.invitationIds.length) await FamilyInvitationModel.updateMany({ _id: { $in: m.invitationIds }, suggestedProfileId: m.keepId }, { $set: { suggestedProfileId: m.otherId } }, { session });
      if (m.contributionIds.length) await FamilyContributionModel.updateMany({ _id: { $in: m.contributionIds }, targetId: m.keepId }, { $set: { targetId: m.otherId } }, { session });

      await keep.save({ session });
      other.deletedAt = null;
      other.deletedBy = null;
      other.set('mergedInto', null);
      await other.save({ session });
      m.status = 'undone';
      m.undoneAt = new Date();
      m.undoneBy = actor.userId;
      await m.save({ session });
      await this.audit.record(
        { familyId, actorId: actor.userId, actorRole: access.role, action: 'member.merge.undo', targetType: 'member', targetId: m.keepId, after: { separated: { id: m.otherId, name: m.otherName } }, requestId: actor.requestId, ip: actor.ip },
        session,
      );
      await this.families.refreshStats(familyId, session);
      return m;
    });
    await this.graph.request(familyId);
    return this.toView(access, merge);
  }

  private async toView(access: FamilyAccess, m: InstanceType<typeof MemberMergeModel>): Promise<MergeView> {
    const [keep, user] = await Promise.all([
      FamilyMemberModel.findOne({ _id: m.keepId, familyId: access.familyId, ...live }),
      UserModel.findById(m.createdBy, { displayName: 1 }).lean(),
    ]);
    const policy = new MemberPolicy(access);
    return {
      id: m.id as string,
      keep: keep && policy.isVisible(keep) ? toPersonCard(keep, policy) : null,
      otherName: m.otherName,
      status: m.status as MergeView['status'],
      createdAt: (m.get('createdAt') as Date).toISOString(),
      createdBy: user?.displayName ?? null,
      undoneAt: m.undoneAt ? m.undoneAt.toISOString() : null,
      linksMoved: m.links.filter((l) => l.change === 'moved').length,
      linksDropped: m.links.filter((l) => l.change === 'removed').length,
      itemsMoved: (['media', 'stories', 'events'] as const).reduce((n, k) => n + (m.replaced?.[k]?.length ?? 0) + (m.pulled?.[k]?.length ?? 0), 0),
    };
  }
}
