import mongoose, { Types, type ClientSession, type PipelineStage } from 'mongoose';
import {
  nameWords,
  normalizeName,
  phoneticKeys,
  searchTokens,
  type MemberView,
  type PersonCard,
  type RelativeLink,
  type SiblingLink,
} from '@fh/contracts';
import { FamilyMediaModel } from '../media/media.model.js';
import { AppError } from '../../core/errors.js';
import { isClearlyAfter } from '../../core/fuzzy-date.js';
import { escapeRegex, pageMeta } from '../../core/validation.js';
import type { AuditService } from '../audit/audit.service.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import type { FamiliesService } from '../families/families.service.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { noGraphListener, type Actor, type GraphChangeListener, type RelationshipsService } from '../relationships/relationships.service.js';
import { FamilyMemberModel, type FamilyMemberDoc } from './member.model.js';
import { toFuzzyDate, toMemberView, toPersonCard } from './member.mapper.js';
import { MemberPolicy } from './member.policy.js';
import type { BranchesService } from '../branches/branches.service.js';
import { LineageService } from '../lineage/lineage.service.js';
import type { ListMembersQueryParsed, MemberInputParsed, UpdateMemberParsed } from './member.validators.js';

const live = { deletedAt: null };
const lineage = new LineageService();

/** Fields people may change directly on their own claimed profile. */
export const OWN_PROFILE_FIELDS = new Set(['profilePhotoMediaId', 'preferredName', 'biography', 'education', 'occupations', 'achievements', 'contact', 'nationality', 'hometown', 'privacy']);

type Links = {
  parents?: { memberId: string; subtype: string; verification: 'verified' | 'unverified' | 'disputed' }[];
  children?: { memberId: string; subtype: string; verification: 'verified' | 'unverified' | 'disputed' }[];
  partners?: { memberId: string; subtype: string; status?: string; verification: 'verified' | 'unverified' | 'disputed' }[];
};

/** Orders family IDs as people read them: G1.2 before G1.10, a person before their spouses and children. */
export function compareFamilyCodes(a: string, b: string): number {
  const parts = (c: string) => c.slice(1).split(/(?=[.-][A-Z]?\d)/).map((p) => (p.startsWith('.') ? [0, Number(p.slice(1))] : p.startsWith('-') && /[A-Z]/.test(p[1]!) ? [-1, Number(p.slice(2))] : [0, Number(p)]));
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const d = pa[i]![0]! - pb[i]![0]! || pa[i]![1]! - pb[i]![1]!;
    if (d) return d;
  }
  return pa.length - pb.length;
}

/** Name-derived search fields, recomputed whenever a name changes. */
export function searchFields(m: {
  firstName: string;
  middleNames?: string | null;
  surname?: string | null;
  maidenName?: string | null;
  preferredName?: string | null;
  previousNames?: string[] | null;
}) {
  const words = nameWords(m.firstName, m.middleNames, m.surname, m.maidenName, m.preferredName, ...(m.previousNames ?? []));
  return { searchTokens: searchTokens(words), phoneticKeys: phoneticKeys(words) };
}

/** A profile photo must be a published photo of this family that family members may see. */
async function checkProfilePhoto(access: FamilyAccess, mediaId: unknown): Promise<void> {
  if (!mediaId) return;
  const ok = await FamilyMediaModel.exists({ _id: mediaId, familyId: access.familyId, kind: 'photo', status: 'published', privacy: { $ne: 'admins' }, deletedAt: null });
  if (!ok) throw new AppError('VALIDATION_FAILED', 'Choose a published photo from the family archive', [{ path: 'profilePhotoMediaId', message: 'Not an available photo' }]);
}

function checkDates(m: { birthDate?: unknown; deathDate?: unknown }): void {
  if (isClearlyAfter(m.birthDate as never, m.deathDate as never)) {
    throw new AppError('VALIDATION_FAILED', 'The date of death is before the date of birth', [
      { path: 'deathDate', message: 'Must be after the date of birth' },
    ]);
  }
}

export class MembersService {
  constructor(
    private readonly relationships: RelationshipsService,
    private readonly families: FamiliesService,
    private readonly audit: AuditService,
    private readonly graph: GraphChangeListener = noGraphListener,
    private readonly branches?: BranchesService,
  ) {}

  private scope(access: FamilyAccess, people: Types.ObjectId[], session?: ClientSession): Promise<string[]> {
    return this.branches ? this.branches.scopeFor(access, people, session) : Promise.resolve([]);
  }

  // ------------------------------------------------------------------ create

  /** Creates a person inside an existing transaction (also used for a family's founder). */
  async createInSession(access: FamilyAccess, actor: Actor, person: MemberInputParsed, session: ClientSession): Promise<FamilyMemberDoc> {
    checkDates(person);
    await checkProfilePhoto(access, (person as { profilePhotoMediaId?: unknown }).profilePhotoMediaId);
    const [doc] = await FamilyMemberModel.create(
      [
        {
          ...person,
          familyId: access.familyId,
          vitalStatus: person.vitalStatus ?? 'unknown',
          privacy: { level: person.privacy?.level ?? 'family', hideDates: person.privacy?.hideDates ?? false },
          ...searchFields(person),
          generation: { number: null, status: 'pending', candidates: [], override: null, computedAt: null },
          createdBy: actor.userId,
        },
      ],
      { session },
    );
    await this.audit.record(
      {
        familyId: access.familyId,
        actorId: actor.userId,
        actorRole: access.role,
        action: 'member.create',
        targetType: 'member',
        targetId: doc!._id,
        after: doc!.toObject(),
        contributionId: actor.contributionId ?? null,
        requestId: actor.requestId,
        ip: actor.ip,
      },
      session,
    );
    return doc!;
  }

  async create(access: FamilyAccess, actor: Actor, person: MemberInputParsed, links: Links = {}): Promise<FamilyMemberDoc> {
    // A new person belongs to the branches of their parents (or, for a partner, of that partner).
    const anchors = [...(links.parents ?? []), ...(links.partners ?? [])].filter((l) => Types.ObjectId.isValid(l.memberId)).map((l) => new Types.ObjectId(l.memberId));
    const branchIds = await this.scope(access, anchors);
    access.assert('member.create', { branchIds });
    const hasLinks = (links.parents?.length ?? 0) + (links.children?.length ?? 0) + (links.partners?.length ?? 0) > 0;
    if (hasLinks) access.assert('relationship.manage', { branchIds });

    const created = await mongoose.connection.transaction(async (session) => {
      const doc = await this.createInSession(access, actor, person, session);
      const id = doc._id.toString();
      for (const p of links.parents ?? []) {
        await this.relationships.createInSession(access, actor, { type: 'parent_child', personA: p.memberId, personB: id, subtype: p.subtype as never, verification: p.verification }, session);
      }
      for (const c of links.children ?? []) {
        await this.relationships.createInSession(access, actor, { type: 'parent_child', personA: id, personB: c.memberId, subtype: c.subtype as never, verification: c.verification }, session);
      }
      for (const p of links.partners ?? []) {
        await this.relationships.createInSession(
          access,
          actor,
          { type: 'partnership', personA: id, personB: p.memberId, subtype: p.subtype as never, status: p.status as never, verification: p.verification },
          session,
        );
      }
      await this.families.refreshStats(access.familyId, session);
      return doc;
    });
    await this.graph.request(access.familyId);
    return created;
  }

  // ------------------------------------------------------------------ read

  private async loadLive(access: FamilyAccess, id: Types.ObjectId, session?: ClientSession): Promise<FamilyMemberDoc> {
    const doc = await FamilyMemberModel.findOne({ _id: id, familyId: access.familyId, ...live })
      .select('+contact')
      .session(session ?? null);
    if (!doc) throw AppError.notFound('Person');
    return doc;
  }

  async get(access: FamilyAccess, id: Types.ObjectId): Promise<MemberView> {
    access.assert('member.view', { isPublic: access.isPublicFamily });
    const policy = new MemberPolicy(access, await this.scope(access, [id]));
    const doc = await this.loadLive(access, id);
    if (!policy.isVisible(doc)) throw AppError.notFound('Person');
    const claimed = await FamilyMembershipModel.exists({ familyId: access.familyId, memberProfileId: doc._id, status: 'active' });
    return toMemberView(doc, policy, await this.relativesOf(access, policy, doc._id), !!claimed, await lineage.forMember(access, policy, doc._id));
  }

  /** Parents, children, partners (stored edges) and siblings (derived from shared parents). */
  private async relativesOf(access: FamilyAccess, policy: MemberPolicy, id: Types.ObjectId) {
    const familyId = access.familyId;
    const direct = await RelationshipModel.find({ familyId, $or: [{ personA: id }, { personB: id }], ...live });
    const parentEdges = direct.filter((e) => e.type === 'parent_child' && e.personB.equals(id));
    const childEdges = direct.filter((e) => e.type === 'parent_child' && e.personA.equals(id));
    const partnerEdges = direct.filter((e) => e.type === 'partnership');
    const parentIds = parentEdges.map((e) => e.personA);
    const siblingEdges = parentIds.length
      ? await RelationshipModel.find({ familyId, type: 'parent_child', personA: { $in: parentIds }, personB: { $ne: id }, ...live })
      : [];

    const relatedIds = new Set<string>();
    for (const e of [...direct, ...siblingEdges]) {
      relatedIds.add(e.personA.toString());
      relatedIds.add(e.personB.toString());
    }
    relatedIds.delete(id.toString());
    const people = await FamilyMemberModel.find({ _id: { $in: [...relatedIds].map((x) => new Types.ObjectId(x)) }, familyId, ...live });
    const cards = new Map<string, PersonCard>();
    for (const p of people) if (policy.isVisible(p)) cards.set(p.id as string, toPersonCard(p, policy));

    const link = (e: (typeof direct)[number], other: Types.ObjectId): RelativeLink[] => {
      const person = cards.get(other.toString());
      if (!person) return [];
      const plain = e.toObject();
      return [
        {
          relationshipId: e.id as string,
          person,
          subtype: e.subtype,
          status: e.status ?? null,
          verification: e.verification,
          startDate: toFuzzyDate(plain.startDate),
          endDate: toFuzzyDate(plain.endDate),
        },
      ];
    };

    const mySubtypeByParent = new Map(parentEdges.map((e) => [e.personA.toString(), e.subtype]));
    const bySibling = new Map<string, { shared: string[]; bioShared: number }>();
    for (const e of siblingEdges) {
      const sib = e.personB.toString();
      const parent = e.personA.toString();
      const entry = bySibling.get(sib) ?? { shared: [], bioShared: 0 };
      if (!entry.shared.includes(parent)) {
        entry.shared.push(parent);
        if (e.subtype === 'biological' && mySubtypeByParent.get(parent) === 'biological') entry.bioShared++;
      }
      bySibling.set(sib, entry);
    }
    const siblings: SiblingLink[] = [];
    for (const [sib, { shared, bioShared }] of bySibling) {
      const person = cards.get(sib);
      if (!person) continue;
      siblings.push({ person, kind: bioShared >= 2 ? 'full' : bioShared === 1 ? 'half' : 'step_or_adoptive', sharedParentIds: shared });
    }

    const byBirth = (a: { person: PersonCard }, b: { person: PersonCard }) =>
      (a.person.birthDate?.sortKey ?? Number.MAX_SAFE_INTEGER) - (b.person.birthDate?.sortKey ?? Number.MAX_SAFE_INTEGER) ||
      a.person.displayName.localeCompare(b.person.displayName);

    return {
      parents: parentEdges.flatMap((e) => link(e, e.personA)),
      children: childEdges.flatMap((e) => link(e, e.personB)).sort(byBirth),
      partners: partnerEdges.flatMap((e) => link(e, e.personA.equals(id) ? e.personB : e.personA)),
      siblings: siblings.sort(byBirth),
    };
  }

  /**
   * Lists people with filters. With `q`, matches every query word against name prefixes and also
   * against phonetic keys (spelling variations); exact-spelling matches rank first.
   */
  async list(access: FamilyAccess, query: ListMembersQueryParsed) {
    access.assert('member.view', { isPublic: access.isPublicFamily });
    const policy = new MemberPolicy(access);
    const match: Record<string, unknown> = { familyId: access.familyId, ...live, ...policy.visibilityFilter() };
    const guest = policy.isGuest;
    if (query.generation) match['generation.number'] = query.generation;
    if (query.generationStatus) match['generation.status'] = query.generationStatus;
    if (query.branchId) {
      if (!this.branches) throw new Error('Branch filtering requires BranchesService');
      match['_id'] = { $in: await this.branches.memberIds(access, new Types.ObjectId(query.branchId)) };
    }
    // Filters on details that may be withheld are not offered to guests beyond what they can see anyway.
    if (query.vitalStatus && !guest) match['vitalStatus'] = query.vitalStatus;
    if (query.hometown) match['hometown'] = new RegExp(`^${escapeRegex(query.hometown.trim())}`, 'i');
    if (query.birthYear) match['birthDate.year'] = query.birthYear;
    // Filtering on details that are withheld from this viewer would reveal them, so those people
    // are excluded from detail-filtered results for non-editors.
    if (!policy.isEditor && (query.vitalStatus || query.hometown || query.birthYear)) {
      match['privacy.level'] = guest ? 'public' : { $ne: 'restricted' };
      if (access.family.privacy?.showLivingToMembers === false) match['vitalStatus'] = 'deceased';
    }

    let tokens: string[] = [];
    // A family ID (G1.2, g1.2-w1): that person and everyone below them, in ID order.
    const code = query.q?.trim().toUpperCase();
    if (code && /^G-?\d+(\.\d+)*(-[WHS]\d*)?$/.test(code)) {
      match['familyCode'] = new RegExp(`^${escapeRegex(code)}($|[.-])`);
      const docs = (await FamilyMemberModel.find(match)).filter((d) => policy.isVisible(d)).sort((a, b) => compareFamilyCodes(a.familyCode!, b.familyCode!));
      const rows = docs.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
      return { data: rows.map((d) => toPersonCard(d, policy)), meta: pageMeta(query, docs.length) };
    }
    if (query.q) {
      tokens = normalizeName(query.q).split(/\s+/).filter((t) => t.length >= 2);
      if (tokens.length === 0) return { data: [] as PersonCard[], meta: pageMeta(query, 0) };
      match['$or'] = [{ searchTokens: { $all: tokens } }, { phoneticKeys: { $all: phoneticKeys(tokens) } }];
    }

    const sort: Record<string, 1 | -1> =
      query.sort === 'birth'
        ? { 'birthDate.sortKey': 1, surname: 1, firstName: 1 }
        : query.sort === 'generation'
          ? { 'generation.number': 1, surname: 1, firstName: 1 }
          : query.sort === 'recent'
            ? { createdAt: -1 }
            : { surname: 1, firstName: 1 };

    // Without a search there is nothing to score: an indexed find plus a count avoids sorting the whole family.
    if (!tokens.length) {
      const [docs, total] = await Promise.all([
        FamilyMemberModel.find(match).sort({ ...sort, _id: 1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize),
        FamilyMemberModel.countDocuments(match),
      ]);
      return { data: docs.filter((d) => policy.isVisible(d)).map((d) => toPersonCard(d, policy)), meta: pageMeta(query, total) };
    }

    const pipeline: PipelineStage[] = [
      { $match: match },
      { $addFields: { _score: tokens.length ? { $cond: [{ $setIsSubset: [tokens, '$searchTokens'] }, 2, 1] } : 0 } },
      { $sort: { _score: -1, ...sort, _id: 1 } },
      {
        $facet: {
          rows: [{ $skip: (query.page - 1) * query.pageSize }, { $limit: query.pageSize }],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [result] = await FamilyMemberModel.aggregate<{ rows: unknown[]; total: { n: number }[] }>(pipeline);
    const docs = (result?.rows ?? []).map((r) => FamilyMemberModel.hydrate(r));
    // Restricted profiles still appear in member lists (names only), but guests never see hidden people.
    const data = docs.filter((d) => policy.isVisible(d)).map((d) => toPersonCard(d, policy));
    return { data, meta: pageMeta(query, result?.total[0]?.n ?? 0) };
  }

  /** The extra details already used in this family, most used first, to suggest consistent names. */
  async attributeNames(access: FamilyAccess): Promise<string[]> {
    access.assert('member.view');
    const rows = await FamilyMemberModel.aggregate<{ _id: string; n: number }>([
      { $match: { familyId: access.familyId, deletedAt: null } },
      { $unwind: '$attributes' },
      { $group: { _id: '$attributes.name', n: { $sum: 1 } } },
      { $sort: { n: -1, _id: 1 } },
      { $limit: 200 },
    ]);
    return rows.map((r) => r._id);
  }

  // ------------------------------------------------------------------ update & delete

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: UpdateMemberParsed): Promise<FamilyMemberDoc> {
    const branchIds = await this.scope(access, [id]);
    if (!access.can('member.update', { branchIds })) {
      // People may keep their own claimed profile's personal details up to date themselves;
      // genealogical facts (names, dates, life status) still go through review.
      const own = access.ownProfileId?.equals(id) ?? false;
      const fields = Object.keys(patch).filter((k) => k !== 'version');
      const disallowed = fields.filter((k) => !OWN_PROFILE_FIELDS.has(k));
      if (!own || disallowed.length) access.assert('member.update', { branchIds });
    }
    if ('profilePhotoMediaId' in patch) await checkProfilePhoto(access, patch.profilePhotoMediaId);
    const updated = await mongoose.connection.transaction(async (session) => {
      const doc = await this.loadLive(access, id, session);
      if ((doc.get('version') as number) !== patch.version) {
        throw new AppError('VERSION_CONFLICT', 'This profile was changed by someone else. Reload and try again.');
      }
      const before = doc.toObject();
      const { version: _version, privacy, ...fields } = patch;
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) doc.set(key, value);
      }
      if (privacy) {
        if (privacy.level) doc.set('privacy.level', privacy.level);
        if (privacy.hideDates !== undefined) doc.set('privacy.hideDates', privacy.hideDates);
      }
      const merged = doc.toObject();
      if (merged.vitalStatus === 'living' && (merged.deathDate || merged.deathPlace)) {
        throw new AppError('VALIDATION_FAILED', 'A living person cannot have a date or place of death', [{ path: 'vitalStatus', message: 'Remove the death details first' }]);
      }
      if (merged.privacy?.level === 'public' && merged.vitalStatus !== 'deceased') {
        throw new AppError('VALIDATION_FAILED', 'Only deceased people can be made public', [{ path: 'privacy.level', message: 'Only deceased people can be public' }]);
      }
      checkDates(merged);
      doc.set(searchFields(merged));
      doc.updatedBy = actor.userId;
      await doc.save({ session });
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'member.update', targetType: 'member', targetId: doc._id, before, after: doc.toObject(), contributionId: actor.contributionId ?? null, requestId: actor.requestId, ip: actor.ip },
        session,
      );
      await this.families.refreshStats(access.familyId, session);
      return doc;
    });
    // Life status and birth year feed the per-generation statistics.
    await this.graph.request(access.familyId);
    return updated;
  }

  /**
   * How the viewer may change this person's profile photo: straight away (editors, and people on their own
   * claimed profile), by suggestion (it waits for a moderator), or not at all.
   */
  async profilePhotoMode(access: FamilyAccess, id: Types.ObjectId): Promise<'direct' | 'propose' | null> {
    if (access.ownProfileId?.equals(id)) return 'direct';
    if (access.can('member.update', { branchIds: await this.scope(access, [id]) })) return 'direct';
    return access.membership && access.canPropose('member.update') ? 'propose' : null;
  }

  /** Makes a published family photo someone's profile photo. Callers check that the viewer may do this. */
  async setProfilePhoto(access: FamilyAccess, actor: Actor, id: Types.ObjectId, mediaId: Types.ObjectId): Promise<void> {
    await checkProfilePhoto(access, mediaId);
    const doc = await FamilyMemberModel.findOne({ _id: id, familyId: access.familyId, deletedAt: null });
    if (!doc) throw AppError.notFound('Person');
    const before = doc.profilePhotoMediaId ?? null;
    doc.profilePhotoMediaId = mediaId;
    doc.updatedBy = actor.userId;
    await doc.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'member.update', targetType: 'member', targetId: doc._id, before: { profilePhotoMediaId: before }, after: { profilePhotoMediaId: mediaId }, contributionId: actor.contributionId ?? null, requestId: actor.requestId, ip: actor.ip });
  }

  /** Soft-deletes a person and their relationships. The founding ancestor must be replaced first. */
  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    access.assert('member.delete');
    await mongoose.connection.transaction(async (session) => {
      const doc = await this.loadLive(access, id, session);
      if (access.family.foundingMemberId?.equals(doc._id)) {
        throw new AppError('CONFLICT', 'This person is the founding ancestor. Choose a different founder before removing them.');
      }
      const claimed = await FamilyMembershipModel.exists({ familyId: access.familyId, memberProfileId: doc._id, status: 'active' }).session(session);
      if (claimed) throw new AppError('CONFLICT', 'A family member has claimed this profile. Unlink their account before removing it.');
      const at = new Date();
      doc.deletedAt = at;
      doc.deletedBy = actor.userId;
      await doc.save({ session });
      // Same timestamp on the person and their links, so a restore can bring both back together.
      const edges = await this.relationships.removeAllFor(access, actor, doc._id, session, at);
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'member.delete', targetType: 'member', targetId: doc._id, before: doc.toObject(), after: { relationshipsRemoved: edges }, contributionId: actor.contributionId ?? null, requestId: actor.requestId, ip: actor.ip },
        session,
      );
      await this.families.refreshStats(access.familyId, session);
    });
    await this.graph.request(access.familyId);
  }

  /**
   * Resolves a generation conflict by choosing one of the candidate numbers (or clears the choice
   * with `null`). Audited; the engine re-applies it on every recalculation while it stays valid.
   */
  async setGenerationOverride(access: FamilyAccess, actor: Actor, id: Types.ObjectId, choice: { number: number; reason: string } | null): Promise<void> {
    access.assert('generation.recalculate');
    await mongoose.connection.transaction(async (session) => {
      const doc = await this.loadLive(access, id, session);
      const before = doc.generation?.override ? { ...doc.toObject().generation?.override } : null;
      if (choice) {
        const g = doc.generation;
        // A conflict lists its candidates; an already-resolved person keeps them, so the choice can be changed.
        const candidates = g?.status === 'conflict' || g?.override ? (g?.candidates ?? []) : [];
        if (!candidates.includes(choice.number)) {
          throw new AppError('VALIDATION_FAILED', 'Only a generation conflict can be resolved, and only to one of its candidate numbers', [
            { path: 'number', message: candidates.length ? `Choose one of ${candidates.join(', ')}` : 'This person has no generation conflict' },
          ]);
        }
        doc.set('generation.override', { number: choice.number, reason: choice.reason, by: actor.userId, at: new Date() });
      } else {
        doc.set('generation.override', null);
      }
      await doc.save({ session });
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: choice ? 'generation.override' : 'generation.override.clear', targetType: 'member', targetId: doc._id, before, after: choice, contributionId: actor.contributionId ?? null, requestId: actor.requestId, ip: actor.ip },
        session,
      );
    });
    await this.graph.request(access.familyId);
  }

  /** People removed from the family, newest first (administrators). */
  async listDeleted(access: FamilyAccess) {
    access.assert('record.restore');
    const policy = new MemberPolicy(access);
    // People merged into someone else are brought back by undoing the merge, not from here.
    const docs = await FamilyMemberModel.find({ familyId: access.familyId, deletedAt: { $ne: null }, mergedInto: null }).sort({ deletedAt: -1 }).limit(200);
    return docs.map((d) => ({ ...toPersonCard(d, policy), deletedAt: d.deletedAt!.toISOString() }));
  }

  /**
   * Brings back a removed person and the links removed with them. A link that would now break an
   * integrity rule (e.g. a duplicate added since) is left removed and reported.
   */
  async restore(access: FamilyAccess, actor: Actor, id: Types.ObjectId) {
    access.assert('record.restore');
    const result = await mongoose.connection.transaction(async (session) => {
      const doc = await FamilyMemberModel.findOne({ _id: id, familyId: access.familyId, deletedAt: { $ne: null } }).session(session);
      if (!doc) throw AppError.notFound('Removed person');
      if (doc.get('mergedInto')) throw new AppError('CONFLICT', 'This person was merged into someone else. Undo the merge to separate them again.');
      const removedAt = doc.deletedAt!;
      doc.deletedAt = null;
      doc.deletedBy = null;
      await doc.save({ session });
      const outcome = await this.relationships.restoreRemovedWith(access, actor, id, removedAt, session);
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'member.restore', targetType: 'member', targetId: id, after: { ...outcome }, contributionId: actor.contributionId ?? null, requestId: actor.requestId, ip: actor.ip },
        session,
      );
      await this.families.refreshStats(access.familyId, session);
      return outcome;
    });
    await this.graph.request(access.familyId);
    return result;
  }
}
