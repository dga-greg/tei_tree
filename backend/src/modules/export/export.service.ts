import { Types } from 'mongoose';
import { z } from 'zod';
import type { AuditService } from '../audit/audit.service.js';
import { AuditLogModel } from '../audit/audit-log.model.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import { FamilyContributionModel } from '../contributions/contribution.model.js';
import { FamilyEventModel } from '../events/event.model.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { FamilyMediaModel } from '../media/media.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { MemberPolicy } from '../members/member.policy.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import type { Actor } from '../relationships/relationships.service.js';
import { AuthSessionModel } from '../auth/session.model.js';
import { FamilyStoryModel } from '../stories/story.model.js';
import { UserModel } from '../users/user.model.js';
import { toGedcom, type GedcomPerson } from './gedcom.js';
import { PushSubscriptionModel } from '../notifications/notifications.model.js';

export const exportQuery = z.object({
  format: z.enum(['json', 'gedcom']).default('json'),
  /** `private` replaces living people's details with "Living" — for sharing a copy outside the family. */
  living: z.enum(['include', 'private']).default('include'),
});

/** Internal fields that mean nothing outside this application. */
const INTERNAL = new Set(['__v', 'familyId', 'searchTokens', 'phoneticKeys', 'searchText', 'storageKey', 'thumbKey', 'deletedAt', 'deletedBy', 'sortKey', 'passwordHash', 'tokenHash', 'totpSecret', 'pendingSecret', 'recoveryCodes', 'lastUsedStep']);

/** Turns a lean MongoDB document into plain JSON: `_id` → `id`, ids and dates as strings, internals dropped. */
export function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Types.ObjectId) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (INTERNAL.has(k)) continue;
      out[k === '_id' ? 'id' : k] = plain(v);
    }
    return out;
  }
  return value;
}

const slug = (name: string) => name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'family';

/** Family exports (JSON and GEDCOM) for administrators, and personal data exports for every account. */
export class ExportService {
  constructor(private readonly audit: AuditService) {}

  async familyExport(access: FamilyAccess, actor: Actor, query: z.output<typeof exportQuery>): Promise<{ filename: string; contentType: string; body: string }> {
    access.assert('family.export');
    const familyId = access.familyId;
    const live = { familyId, deletedAt: null };
    const policy = new MemberPolicy(access);
    const [people, edges] = await Promise.all([
      FamilyMemberModel.find(live).select('+contact').sort({ 'birthDate.sortKey': 1, _id: 1 }).lean(),
      RelationshipModel.find(live).lean(),
    ]);
    const hide = (p: (typeof people)[number]) => query.living === 'private' && policy.presumedLiving(p as never);
    const stamp = new Date();
    const base = `${slug(access.family.name)}-${stamp.toISOString().slice(0, 10)}`;
    await this.audit.record({ familyId, actorId: actor.userId, actorRole: access.role, action: 'family.export', targetType: 'family', targetId: familyId, after: { format: query.format, living: query.living, people: people.length }, requestId: actor.requestId, ip: actor.ip });

    if (query.format === 'gedcom') {
      const gPeople: GedcomPerson[] = people.map((p) => ({
        id: p._id.toString(),
        firstName: p.firstName,
        middleNames: p.middleNames,
        surname: p.surname,
        maidenName: p.maidenName,
        preferredName: p.preferredName,
        title: p.title,
        gender: p.gender ?? null,
        vitalStatus: p.vitalStatus,
        birthDate: p.birthDate as never,
        birthPlace: p.birthPlace,
        deathDate: p.deathDate as never,
        deathPlace: p.deathPlace,
        occupations: (p.occupations ?? []).map((o) => [o.title, o.organisation].filter(Boolean).join(', ')),
        education: (p.education ?? []).map((e) => [e.title, e.organisation].filter(Boolean).join(', ')),
        biography: p.biography,
        privatised: hide(p),
      }));
      const body = toGedcom({
        familyName: access.family.name,
        exportedAt: stamp,
        people: gPeople,
        parentLinks: edges.filter((e) => e.type === 'parent_child' && e.verification !== 'disputed').map((e) => ({ parentId: e.personA.toString(), childId: e.personB.toString(), subtype: e.subtype })),
        partnerships: edges
          .filter((e) => e.type === 'partnership')
          .map((e) => ({ id: e._id.toString(), personA: e.personA.toString(), personB: e.personB.toString(), subtype: e.subtype, status: e.status ?? null, startDate: e.startDate as never, endDate: e.endDate as never })),
      });
      return { filename: `${base}.ged`, contentType: 'text/vnd.familysearch.gedcom; charset=utf-8', body };
    }

    const [family, branches, events, stories, media] = await Promise.all([
      FamilyModel.findById(familyId).lean(),
      FamilyBranchModel.find({ familyId }).lean(),
      FamilyEventModel.find(live).lean(),
      FamilyStoryModel.find({ ...live, status: 'published' }).lean(),
      FamilyMediaModel.find({ ...live, status: 'published' }).lean(),
    ]);
    const doc = {
      format: 'family-heritage/v1',
      exportedAt: stamp.toISOString(),
      notes: [
        'People, relationships, branches, events, published stories and file details of one family.',
        'Files themselves are not included; download them from Photos & documents.',
        'Accounts and their e-mail addresses are not included.',
        ...(query.living === 'private' ? ['Details of living people have been removed.'] : []),
      ],
      family: plain({ ...family, generationState: undefined }),
      people: people.map((p) => (hide(p) ? { id: p._id.toString(), firstName: 'Living', surname: p.surname, living: true } : plain(p))),
      relationships: plain(edges),
      branches: plain(branches.map((b) => ({ ...b, stats: undefined }))),
      events: plain(events),
      stories: plain(stories),
      files: plain(media.map((m) => ({ ...m, fileName: m.originalName }))),
    };
    return { filename: `${base}.json`, contentType: 'application/json; charset=utf-8', body: JSON.stringify(doc, null, 2) };
  }

  /** Everything the platform holds about one account (GDPR-style access request). */
  async personalExport(userId: Types.ObjectId): Promise<{ filename: string; body: string }> {
    const [user, sessions, memberships, contributions, uploads, stories, actions] = await Promise.all([
      UserModel.findById(userId).lean(),
      AuthSessionModel.find({ userId }).lean(),
      FamilyMembershipModel.find({ userId }).lean(),
      FamilyContributionModel.find({ proposedBy: userId }).lean(),
      FamilyMediaModel.find({ uploadedBy: userId, deletedAt: null }).lean(),
      FamilyStoryModel.find({ createdBy: userId, deletedAt: null }).lean(),
      AuditLogModel.find({ actorId: userId }).sort({ at: -1 }).limit(5000).lean(),
    ]);
    const devices = await PushSubscriptionModel.find({ userId }, { userAgent: 1, createdAt: 1, lastSentAt: 1 }).lean();
    const families = await FamilyModel.find({ _id: { $in: memberships.map((m) => m.familyId) } }, { name: 1 }).lean();
    const familyName = (id: Types.ObjectId) => families.find((f) => f._id.equals(id))?.name ?? null;
    const doc = {
      format: 'family-heritage/account/v1',
      exportedAt: new Date().toISOString(),
      account: plain({ ...user, failedLoginCount: undefined, lockedUntil: undefined }),
      sessions: sessions.map((s) => ({ createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt?.toISOString() ?? null, userAgent: s.userAgent ?? null, ip: s.ip ?? null, revokedAt: s.revokedAt?.toISOString() ?? null })),
      // Devices that receive notifications (their push addresses are credentials and are left out).
      notificationDevices: devices.map((d) => ({ userAgent: d.userAgent, addedAt: d.createdAt.toISOString(), lastNotifiedAt: d.lastSentAt?.toISOString() ?? null })),
      memberships: memberships.map((m) => ({ family: familyName(m.familyId), familyId: m.familyId.toString(), role: m.role, status: m.status, claimedProfileId: m.memberProfileId?.toString() ?? null, joinedAt: (m as { joinedAt?: Date }).joinedAt?.toISOString() ?? null })),
      suggestions: contributions.map((c) => ({ ...(plain(c) as object), family: familyName(c.familyId) })),
      uploads: uploads.map((m) => ({ ...(plain(m) as object), family: familyName(m.familyId) })),
      stories: stories.map((s) => ({ ...(plain(s) as object), family: familyName(s.familyId) })),
      activity: actions.map((a) => ({ at: a.at.toISOString(), action: a.action, targetType: a.targetType, family: a.familyId ? familyName(a.familyId) : null })),
    };
    return { filename: `my-data-${new Date().toISOString().slice(0, 10)}.json`, body: JSON.stringify(doc, null, 2) };
  }
}
