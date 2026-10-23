import { Types } from 'mongoose';
import { z } from 'zod';
import {
  CONTRIBUTION_KINDS,
  type ContributionChange,
  type ContributionKind,
  type ContributionStatus,
  type ContributionView,
  type PersonCard,
} from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { parse } from '../../core/validation.js';
import type { EmailDispatcher } from '../../infra/queues.js';
import type { AuditService } from '../audit/audit.service.js';
import type { BranchesService } from '../branches/branches.service.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { createMemberBody, memberPatch } from '../members/member.validators.js';
import type { MembersService } from '../members/members.service.js';
import { RelationshipModel, type RelationshipDoc } from '../relationships/relationship.model.js';
import { createRelationshipBody, relationshipPatch } from '../relationships/relationship.validators.js';
import type { Actor, RelationshipsService } from '../relationships/relationships.service.js';
import { UserModel } from '../users/user.model.js';
import type { ArchiveReviewQueue } from '../archive/archive.shared.js';
import { mediaContentPath, type MediaService } from '../media/media.service.js';
import type { StoriesService } from '../stories/stories.service.js';
import { FamilyContributionModel } from './contribution.model.js';
import { contributionDecisionEmail } from './contribution.emails.js';

type ContributionDoc = InstanceType<typeof FamilyContributionModel>;

const reasonBody = z.object({ reason: z.string().trim().min(3, 'Explain why').max(2000) }).strict();
const claimBody = z.object({ evidence: z.string().trim().max(2000).optional() }).strict();

const OPEN: ContributionStatus[] = ['pending', 'needs_clarification'];
const MEMBER_KINDS = new Set<ContributionKind>(['member.update', 'member.delete', 'claim.profile']);
const EDGE_KINDS = new Set<ContributionKind>(['relationship.update', 'relationship.delete']);
/** Filed automatically when a member uploads a file or writes a story; the item waits unpublished. */
const ARCHIVE_KINDS = new Set<ContributionKind>(['media.attach', 'story.create']);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Proposed changes from family members, reviewed by administrators (or moderators within their
 * branches). Approval applies the change through the normal services — so every integrity rule and
 * permission check still runs — and the audit entries reference the contribution.
 */
export class ContributionsService implements ArchiveReviewQueue {
  private archive: { media: MediaService; stories: StoriesService } | null = null;

  constructor(
    private readonly members: MembersService,
    private readonly relationships: RelationshipsService,
    private readonly branches: BranchesService,
    private readonly audit: AuditService,
    private readonly email: EmailDispatcher,
    private readonly appOrigin: string,
  ) {}

  attachArchive(archive: { media: MediaService; stories: StoriesService }): void {
    this.archive = archive;
  }

  async fileArchiveItem(
    access: FamilyAccess,
    actor: Actor,
    input: { kind: 'media.attach' | 'story.create'; targetType: 'media' | 'story'; targetId: Types.ObjectId; memberIds: Types.ObjectId[]; note?: string; profileOf?: Types.ObjectId },
  ): Promise<Types.ObjectId> {
    const doc = await FamilyContributionModel.create({
      familyId: access.familyId,
      kind: input.kind,
      targetType: input.targetType,
      targetId: input.targetId,
      branchIds: await this.branchesOf(access, input.memberIds),
      // Never empty: Mongoose drops empty objects on save, which would then fail the `required` check.
      payload: { item: input.targetType, ...(input.profileOf ? { profileOf: input.profileOf.toString() } : {}) },
      proposedBy: actor.userId,
      discussion: input.note ? [{ by: actor.userId, message: input.note }] : [],
    });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'contribution.submit', targetType: 'contribution', targetId: doc._id, after: { kind: input.kind, targetId: input.targetId }, requestId: actor.requestId, ip: actor.ip });
    return doc._id;
  }

  private async archiveStatus(access: FamilyAccess, actor: Actor, c: ContributionDoc, status: 'published' | 'rejected'): Promise<void> {
    if (c.kind === 'media.attach') await this.archive!.media.setStatus(access, actor, c.targetId!, status, c._id);
    else await this.archive!.stories.setStatus(access, actor, c.targetId!, status, c._id);
  }

  private countAdoptive(access: FamilyAccess): boolean {
    return access.family.generationPolicy?.countAdoptive ?? true;
  }

  private async branchesOf(access: FamilyAccess, people: Types.ObjectId[]): Promise<Types.ObjectId[]> {
    const ids = new Set<string>();
    for (const p of people) for (const b of await this.branches.branchIdsOf(access.familyId, p, this.countAdoptive(access))) ids.add(b);
    return [...ids].map((x) => new Types.ObjectId(x));
  }

  private async liveMember(access: FamilyAccess, id: Types.ObjectId) {
    const doc = await FamilyMemberModel.findOne({ _id: id, familyId: access.familyId, deletedAt: null }).select('+contact');
    if (!doc) throw AppError.notFound('Person');
    return doc;
  }

  private async liveEdge(access: FamilyAccess, id: Types.ObjectId) {
    const edge = await RelationshipModel.findOne({ _id: id, familyId: access.familyId, deletedAt: null });
    if (!edge) throw AppError.notFound('Relationship');
    return edge;
  }

  // ------------------------------------------------------------------ submit

  async submit(access: FamilyAccess, actor: Actor, input: { kind: ContributionKind; targetId?: string; payload: unknown; note?: string }) {
    access.assert('contribution.submit');
    if (ARCHIVE_KINDS.has(input.kind)) {
      throw new AppError('VALIDATION_FAILED', 'Upload the file or write the story directly; it is sent for review automatically.', [{ path: 'kind', message: 'Not submitted here' }]);
    }
    if (!(CONTRIBUTION_KINDS as readonly string[]).includes(input.kind)) throw new AppError('VALIDATION_FAILED', 'Unknown kind of change', [{ path: 'kind', message: 'Unknown kind' }]);
    const targetId = input.targetId ? new Types.ObjectId(input.targetId) : null;
    if ((MEMBER_KINDS.has(input.kind) || EDGE_KINDS.has(input.kind)) && !targetId) {
      throw new AppError('VALIDATION_FAILED', 'Say which record this is about', [{ path: 'targetId', message: 'Required' }]);
    }

    let payload: Record<string, unknown>;
    let previousValues: Record<string, unknown> | null = null;
    let targetVersion: number | null = null;
    let targetType: 'member' | 'relationship';
    let branchIds: Types.ObjectId[] = [];

    switch (input.kind) {
      case 'member.create': {
        const body = parse(createMemberBody, input.payload);
        payload = body as Record<string, unknown>;
        targetType = 'member';
        const anchors = [...(body.links?.parents ?? []), ...(body.links?.partners ?? []), ...(body.links?.children ?? [])].map((l) => new Types.ObjectId(l.memberId));
        branchIds = await this.branchesOf(access, anchors);
        break;
      }
      case 'member.update': {
        const patch = parse(memberPatch, input.payload);
        if (Object.keys(patch).length === 0) throw new AppError('VALIDATION_FAILED', 'Nothing to change', [{ path: 'payload', message: 'Nothing to change' }]);
        const doc = await this.liveMember(access, targetId!);
        const current = doc.toObject() as Record<string, unknown>;
        previousValues = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k] ?? null]));
        targetVersion = doc.get('version') as number;
        payload = patch as Record<string, unknown>;
        targetType = 'member';
        branchIds = await this.branchesOf(access, [doc._id]);
        break;
      }
      case 'member.delete': {
        payload = parse(reasonBody, input.payload);
        const doc = await this.liveMember(access, targetId!);
        if (access.family.foundingMemberId?.equals(doc._id)) throw new AppError('CONFLICT', 'The founding ancestor cannot be removed.');
        targetType = 'member';
        branchIds = await this.branchesOf(access, [doc._id]);
        break;
      }
      case 'claim.profile': {
        payload = parse(claimBody, input.payload ?? {});
        return this.fileClaimFor(access, actor, targetId!, (payload['evidence'] as string | undefined) ?? input.note ?? '');
      }
      case 'relationship.create': {
        const body = parse(createRelationshipBody, input.payload);
        payload = body as Record<string, unknown>;
        targetType = 'relationship';
        branchIds = await this.branchesOf(access, [new Types.ObjectId(body.personA), new Types.ObjectId(body.personB)]);
        break;
      }
      case 'relationship.update': {
        const patch = parse(relationshipPatch, input.payload);
        const edge = await this.liveEdge(access, targetId!);
        const current = edge.toObject() as Record<string, unknown>;
        previousValues = Object.fromEntries(Object.keys(patch).map((k) => [k, current[k] ?? null]));
        targetVersion = edge.get('version') as number;
        payload = patch as Record<string, unknown>;
        targetType = 'relationship';
        branchIds = await this.branchesOf(access, [edge.personA, edge.personB]);
        break;
      }
      case 'relationship.delete': {
        payload = parse(reasonBody, input.payload);
        const edge = await this.liveEdge(access, targetId!);
        targetType = 'relationship';
        branchIds = await this.branchesOf(access, [edge.personA, edge.personB]);
        break;
      }
      default:
        throw new AppError('VALIDATION_FAILED', 'Unknown kind of change', [{ path: 'kind', message: 'Unknown kind' }]);
    }

    const doc = await FamilyContributionModel.create({
      familyId: access.familyId,
      kind: input.kind,
      targetType,
      targetId,
      branchIds,
      payload,
      previousValues,
      targetVersion,
      proposedBy: actor.userId,
      discussion: input.note?.trim() ? [{ by: actor.userId, message: input.note.trim() }] : [],
    });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'contribution.submit', targetType: 'contribution', targetId: doc._id, after: { kind: input.kind, targetId }, requestId: actor.requestId, ip: actor.ip });
    return this.view(access, doc);
  }

  private async fileClaimFor(access: FamilyAccess, actor: Actor, memberId: Types.ObjectId, evidence: string) {
    const user = await UserModel.findById(actor.userId);
    if (!user?.emailVerifiedAt) throw new AppError('FORBIDDEN', 'Confirm your e-mail address before claiming a profile.');
    if (access.ownProfileId) throw new AppError('CONFLICT', 'Your account is already linked to a profile in this family.');
    const doc0 = await this.liveMember(access, memberId);
    if (doc0.vitalStatus === 'deceased') throw new AppError('CONFLICT', 'A profile of someone who has died cannot be claimed.');
    if (await FamilyMembershipModel.exists({ familyId: access.familyId, memberProfileId: doc0._id, status: 'active' })) {
      throw new AppError('CONFLICT', 'Someone has already claimed this profile. Contact a family administrator if this is wrong.');
    }
    if (await FamilyContributionModel.exists({ familyId: access.familyId, kind: 'claim.profile', proposedBy: actor.userId, status: { $in: OPEN } })) {
      throw new AppError('CONFLICT', 'You already have a profile claim waiting for review.');
    }
    const doc = await FamilyContributionModel.create({
      familyId: access.familyId,
      kind: 'claim.profile',
      targetType: 'member',
      targetId: memberId,
      branchIds: await this.branchesOf(access, [memberId]),
      payload: { evidence },
      proposedBy: actor.userId,
      discussion: evidence ? [{ by: actor.userId, message: evidence }] : [],
    });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'contribution.submit', targetType: 'contribution', targetId: doc._id, after: { kind: 'claim.profile', targetId: memberId }, requestId: actor.requestId, ip: actor.ip });
    return this.view(access, doc);
  }

  /** Used when an accepted invitation suggested a profile. Never throws: the claim is optional. */
  async fileClaim(access: FamilyAccess, actor: Actor, memberId: Types.ObjectId, note: string): Promise<Types.ObjectId | null> {
    try {
      return new Types.ObjectId((await this.fileClaimFor(access, actor, memberId, note)).id);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ read

  private reviewable(access: FamilyAccess, c: ContributionDoc): boolean {
    return access.can('contribution.review', { branchIds: c.branchIds.map(String) }) && !c.proposedBy.equals(access.membership?.userId ?? new Types.ObjectId());
  }

  async list(access: FamilyAccess, query: { status?: ContributionStatus | 'open'; mine?: boolean }) {
    access.assert('contribution.submit');
    const filter: Record<string, unknown> = { familyId: access.familyId };
    const status = query.status ?? 'open';
    filter['status'] = status === 'open' ? { $in: OPEN } : status;
    const userId = access.membership!.userId;
    const reviewer = access.can('contribution.review', { branchIds: [] }) || access.isBranchScoped;
    if (query.mine || !reviewer) filter['proposedBy'] = userId;
    else if (access.isBranchScoped) {
      filter['$or'] = [{ proposedBy: userId }, { branchIds: { $in: access.membership!.moderatedBranchIds } }];
    }
    const rows = await FamilyContributionModel.find(filter).sort({ createdAt: -1 }).limit(200);
    return Promise.all(rows.map((r) => this.view(access, r)));
  }

  async get(access: FamilyAccess, id: Types.ObjectId) {
    const c = await this.load(access, id);
    return this.view(access, c);
  }

  private async load(access: FamilyAccess, id: Types.ObjectId): Promise<ContributionDoc> {
    access.assert('contribution.submit');
    const c = await FamilyContributionModel.findOne({ _id: id, familyId: access.familyId });
    if (!c) throw AppError.notFound('Contribution');
    const own = c.proposedBy.equals(access.membership!.userId);
    if (!own && !access.can('contribution.review', { branchIds: c.branchIds.map(String) })) throw AppError.notFound('Contribution');
    return c;
  }

  /** Counts open proposals the viewer can act on (reviewers) or is waiting on (members). */
  async openCount(access: FamilyAccess): Promise<number> {
    if (!access.membership) return 0;
    return (await this.list(access, { status: 'open' })).filter((c) => c.viewerCan.review || c.viewerCan.respond || c.viewerCan.withdraw).length;
  }

  private async view(access: FamilyAccess, c: ContributionDoc): Promise<ContributionView> {
    const policy = new MemberPolicy(access);
    const payload = (c.payload ?? {}) as Record<string, unknown>;
    const userIds = [c.proposedBy, c.reviewedBy, ...c.discussion.map((d) => d.by)].filter((x): x is Types.ObjectId => !!x);
    const users = await UserModel.find({ _id: { $in: userIds } }, { displayName: 1 }).lean();
    const nameOf = (id: Types.ObjectId | null | undefined) => (id ? (users.find((u) => u._id.equals(id))?.displayName ?? 'Former member') : '');

    // People involved, for display.
    const personIds: Types.ObjectId[] = [];
    let edge: RelationshipDoc | null = null;
    if (c.targetType === 'member' && c.targetId) personIds.push(c.targetId);
    if (c.targetType === 'relationship' && c.targetId) {
      edge = await RelationshipModel.findOne({ _id: c.targetId, familyId: access.familyId });
      if (edge) personIds.push(edge.personA, edge.personB);
    }
    if (c.kind === 'relationship.create') personIds.push(new Types.ObjectId(payload['personA'] as string), new Types.ObjectId(payload['personB'] as string));
    const profileOf = c.kind === 'media.attach' && typeof payload['profileOf'] === 'string' ? new Types.ObjectId(payload['profileOf']) : null;
    if (profileOf) personIds.push(profileOf);
    const people = await FamilyMemberModel.find({ _id: { $in: personIds }, familyId: access.familyId });
    const cardOf = (id: Types.ObjectId): PersonCard | null => {
      const p = people.find((x) => x._id.equals(id));
      return p ? toPersonCard(p, policy) : null;
    };
    const target = c.targetType === 'member' && c.targetId ? cardOf(c.targetId) : null;
    const pair = edge ? [cardOf(edge.personA), cardOf(edge.personB)] : c.kind === 'relationship.create' ? [cardOf(personIds[0]!), cardOf(personIds[1]!)] : [];
    const pairNames = pair.map((p) => p?.displayName ?? 'someone');

    // What would change.
    let changes: ContributionChange[] = [];
    let stale = false;
    if (c.kind === 'member.update' || c.kind === 'relationship.update') {
      const current = c.kind === 'member.update'
        ? ((await FamilyMemberModel.findOne({ _id: c.targetId, familyId: access.familyId, deletedAt: null }).select('+contact'))?.toObject() as Record<string, unknown> | undefined)
        : (edge && !edge.deletedAt ? (edge.toObject() as Record<string, unknown>) : undefined);
      const previous = (c.previousValues ?? {}) as Record<string, unknown>;
      changes = Object.entries(payload)
        .filter(([k, v]) => !same(current?.[k], v))
        .map(([field, proposed]) => ({ field, current: current?.[field] ?? null, proposed }));
      stale = !current || Object.keys(payload).some((k) => !same(current[k], previous[k]));
    } else if (c.kind === 'member.create') {
      const person = (payload['person'] ?? {}) as Record<string, unknown>;
      changes = Object.entries(person).map(([field, proposed]) => ({ field, current: null, proposed }));
    }
    let archiveItem: ContributionView['archiveItem'] = null;
    if (ARCHIVE_KINDS.has(c.kind as ContributionKind) && this.archive) {
      if (c.kind === 'media.attach') {
        const m = await this.archive.media.loadAny(access, c.targetId);
        if (m && !m.deletedAt) archiveItem = { type: 'media', id: m.id as string, title: m.title, kind: m.kind, thumbUrl: m.thumbKey ? mediaContentPath(access.familyId, m._id, 'thumb') : null, excerpt: m.description.slice(0, 300) };
      } else {
        const st = await this.archive.stories.loadAny(access, c.targetId);
        if (st && !st.deletedAt) archiveItem = { type: 'story', id: st.id as string, title: st.title, kind: st.kind, thumbUrl: null, excerpt: st.body.slice(0, 300) };
      }
      if (!archiveItem) stale = true;
    }
    if ((c.kind === 'member.delete' && !target) || (c.kind === 'relationship.delete' && (!edge || edge.deletedAt))) {
      stale = true;
    }

    const personName = (payload['person'] as { firstName?: string; surname?: string } | undefined) ?? {};
    const summary = (() => {
      switch (c.kind) {
        case 'member.create': {
          const links = (payload['links'] ?? {}) as { parents?: unknown[]; children?: unknown[]; partners?: unknown[] };
          const linkText = links.parents?.length ? ' as a child' : links.partners?.length ? ' as a partner' : links.children?.length ? ' as a parent' : '';
          return `Add ${[personName.firstName, personName.surname].filter(Boolean).join(' ')}${linkText}`;
        }
        case 'member.update':
          return `Correct details of ${target?.displayName ?? 'a person'}`;
        case 'member.delete':
          return `Remove ${target?.displayName ?? 'a person'}`;
        case 'claim.profile':
          return `${nameOf(c.proposedBy)} says they are ${target?.displayName ?? 'this person'}`;
        case 'relationship.create':
          return payload['type'] === 'partnership' ? `Record ${pairNames[0]} and ${pairNames[1]} as partners` : `Record ${pairNames[0]} as a parent of ${pairNames[1]}`;
        case 'relationship.update':
          return `Correct the link between ${pairNames[0]} and ${pairNames[1]}`;
        case 'relationship.delete':
          return `Remove the link between ${pairNames[0]} and ${pairNames[1]}`;
        case 'media.attach':
          if (profileOf) return `Add “${archiveItem?.title ?? 'a photo'}” as the profile photo of ${cardOf(profileOf)?.displayName ?? 'a person'}`;
          return `Add “${archiveItem?.title ?? 'a file'}” to the archive`;
        case 'story.create':
          return `Add the story “${archiveItem?.title ?? 'untitled'}”`;
        default:
          return 'Proposed change';
      }
    })();

    const open = OPEN.includes(c.status);
    const own = c.proposedBy.equals(access.membership?.userId ?? new Types.ObjectId());
    return {
      id: c.id as string,
      kind: c.kind as ContributionKind,
      status: c.status,
      summary,
      target,
      people: pair.filter((p): p is PersonCard => !!p),
      changes,
      payload,
      archiveItem,
      stale,
      proposedBy: { id: c.proposedBy.toString(), displayName: nameOf(c.proposedBy) },
      reviewedBy: c.reviewedBy ? { id: c.reviewedBy.toString(), displayName: nameOf(c.reviewedBy) } : null,
      reviewNote: c.reviewNote,
      discussion: c.discussion.map((d) => ({ by: d.by.toString(), byName: nameOf(d.by), message: d.message, at: d.at.toISOString() })),
      createdAt: c.createdAt.toISOString(),
      reviewedAt: c.reviewedAt?.toISOString() ?? null,
      viewerCan: {
        review: open && this.reviewable(access, c),
        respond: c.status === 'needs_clarification' && own,
        withdraw: open && own,
      },
    };
  }

  // ------------------------------------------------------------------ review

  private assertReviewer(access: FamilyAccess, c: ContributionDoc): void {
    if (!OPEN.includes(c.status)) throw new AppError('CONFLICT', `This proposal is already ${c.status.replace('_', ' ')}.`);
    if (c.proposedBy.equals(access.membership?.userId ?? new Types.ObjectId())) throw AppError.forbidden('Someone else must review your own proposal.');
    access.assert('contribution.review', { branchIds: c.branchIds.map(String) });
  }

  private async notify(access: FamilyAccess, c: ContributionDoc, outcome: 'approved' | 'rejected' | 'needs_clarification', note: string): Promise<void> {
    const user = await UserModel.findById(c.proposedBy, { email: 1, displayName: 1 }).lean();
    if (!user) return;
    const view = await this.view(access, c);
    this.email.dispatch(
      contributionDecisionEmail({ to: user.email, name: user.displayName, familyName: access.family.name, summary: view.summary, outcome, note, url: new URL('/contributions', this.appOrigin).toString() }),
    );
  }

  async approve(access: FamilyAccess, actor: Actor, id: Types.ObjectId, options: { note?: string; force?: boolean }) {
    const c = await this.load(access, id);
    this.assertReviewer(access, c);
    const view = await this.view(access, c);
    if (view.stale && !options.force) {
      throw new AppError('VERSION_CONFLICT', 'The record has changed since this was proposed. Review the differences and approve again to apply it anyway.');
    }
    const applyAs: Actor = { ...actor, contributionId: c._id };
    const payload = c.payload as Record<string, unknown>;
    const targetId = c.targetId!;
    switch (c.kind) {
      case 'member.create': {
        const body = parse(createMemberBody, payload);
        await this.members.create(access, applyAs, body.person, body.links);
        break;
      }
      case 'member.update': {
        const doc = await this.liveMember(access, targetId);
        await this.members.update(access, applyAs, targetId, { ...parse(memberPatch, payload), version: doc.get('version') as number });
        break;
      }
      case 'member.delete':
        await this.members.remove(access, applyAs, targetId);
        break;
      case 'relationship.create':
        await this.relationships.create(access, applyAs, parse(createRelationshipBody, payload));
        break;
      case 'relationship.update': {
        const edge = await this.liveEdge(access, targetId);
        await this.relationships.update(access, applyAs, targetId, { ...parse(relationshipPatch, payload), version: edge.get('version') as number });
        break;
      }
      case 'relationship.delete':
        await this.relationships.remove(access, applyAs, targetId);
        break;
      case 'media.attach':
      case 'story.create':
        await this.archiveStatus(access, applyAs, c, 'published');
        if (c.kind === 'media.attach' && typeof payload['profileOf'] === 'string') {
          // The photo is published either way; it becomes the profile photo if the person is still there.
          const person = new Types.ObjectId(payload['profileOf']);
          if (await FamilyMemberModel.exists({ _id: person, familyId: access.familyId, deletedAt: null })) await this.members.setProfilePhoto(access, applyAs, person, targetId);
        }
        break;
      case 'claim.profile': {
        const membership = await FamilyMembershipModel.findOne({ familyId: access.familyId, userId: c.proposedBy, status: 'active' });
        if (!membership) throw new AppError('CONFLICT', 'The person who made this claim is no longer a member of the family.');
        if (membership.memberProfileId) throw new AppError('CONFLICT', 'Their account is already linked to a profile.');
        await this.liveMember(access, targetId);
        if (await FamilyMembershipModel.exists({ familyId: access.familyId, memberProfileId: targetId, status: 'active' })) {
          throw new AppError('CONFLICT', 'Someone else has claimed this profile in the meantime.');
        }
        membership.memberProfileId = targetId;
        await membership.save();
        await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'membership.link_profile', targetType: 'membership', targetId: membership._id, after: { memberProfileId: targetId }, contributionId: c._id, requestId: actor.requestId, ip: actor.ip });
        break;
      }
    }
    c.status = 'approved';
    c.reviewedBy = actor.userId;
    c.reviewedAt = new Date();
    c.reviewNote = options.note ?? '';
    await c.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'contribution.approve', targetType: 'contribution', targetId: c._id, after: { kind: c.kind, note: c.reviewNote }, contributionId: c._id, requestId: actor.requestId, ip: actor.ip });
    await this.notify(access, c, 'approved', c.reviewNote);
    return this.view(access, c);
  }

  async reject(access: FamilyAccess, actor: Actor, id: Types.ObjectId, note: string) {
    const c = await this.load(access, id);
    this.assertReviewer(access, c);
    if (ARCHIVE_KINDS.has(c.kind as ContributionKind) && c.targetId) await this.archiveStatus(access, actor, c, 'rejected').catch(() => undefined);
    c.status = 'rejected';
    c.reviewedBy = actor.userId;
    c.reviewedAt = new Date();
    c.reviewNote = note;
    await c.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'contribution.reject', targetType: 'contribution', targetId: c._id, after: { note }, contributionId: c._id, requestId: actor.requestId, ip: actor.ip });
    await this.notify(access, c, 'rejected', note);
    return this.view(access, c);
  }

  async requestClarification(access: FamilyAccess, actor: Actor, id: Types.ObjectId, message: string) {
    const c = await this.load(access, id);
    this.assertReviewer(access, c);
    c.status = 'needs_clarification';
    c.discussion.push({ by: actor.userId, message, at: new Date() });
    await c.save();
    await this.notify(access, c, 'needs_clarification', message);
    return this.view(access, c);
  }

  /** The proposer answers a question; the proposal goes back to the review queue. */
  async respond(access: FamilyAccess, actor: Actor, id: Types.ObjectId, message: string, payload?: unknown) {
    const c = await this.load(access, id);
    if (!c.proposedBy.equals(actor.userId)) throw AppError.forbidden();
    if (c.status !== 'needs_clarification') throw new AppError('CONFLICT', 'No question is waiting for your answer.');
    if (payload !== undefined && ARCHIVE_KINDS.has(c.kind as ContributionKind)) {
      throw new AppError('VALIDATION_FAILED', 'Edit the file or story itself to change it.', [{ path: 'payload', message: 'Not revisable here' }]);
    }
    if (payload !== undefined) {
      // The proposer may also revise what they proposed.
      const revised = await this.submitShape(access, c.kind as ContributionKind, payload);
      c.payload = revised;
      c.markModified('payload');
    }
    c.status = 'pending';
    c.discussion.push({ by: actor.userId, message, at: new Date() });
    await c.save();
    return this.view(access, c);
  }

  private async submitShape(_access: FamilyAccess, kind: ContributionKind, payload: unknown): Promise<Record<string, unknown>> {
    switch (kind) {
      case 'member.create':
        return parse(createMemberBody, payload) as Record<string, unknown>;
      case 'member.update':
        return parse(memberPatch, payload) as Record<string, unknown>;
      case 'relationship.create':
        return parse(createRelationshipBody, payload) as Record<string, unknown>;
      case 'relationship.update':
        return parse(relationshipPatch, payload) as Record<string, unknown>;
      case 'claim.profile':
        return parse(claimBody, payload);
      default:
        return parse(reasonBody, payload);
    }
  }

  async withdraw(access: FamilyAccess, actor: Actor, id: Types.ObjectId) {
    const c = await this.load(access, id);
    if (!c.proposedBy.equals(actor.userId)) throw AppError.forbidden();
    if (!OPEN.includes(c.status)) throw new AppError('CONFLICT', 'Only open proposals can be withdrawn.');
    if (ARCHIVE_KINDS.has(c.kind as ContributionKind) && c.targetId) {
      // Withdrawing an unpublished upload or story removes it.
      if (c.kind === 'media.attach') await this.archive!.media.remove(access, actor, c.targetId).catch(() => undefined);
      else await this.archive!.stories.remove(access, actor, c.targetId).catch(() => undefined);
    }
    c.status = 'withdrawn';
    await c.save();
    return this.view(access, c);
  }
}

