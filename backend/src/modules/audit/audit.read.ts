import { Types } from 'mongoose';
import { displayName, type AuditEntryView, type RestoreResult } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { pageMeta, type Pagination } from '../../core/validation.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { memberPatch } from '../members/member.validators.js';
import type { MembersService } from '../members/members.service.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import type { Actor, RelationshipsService } from '../relationships/relationships.service.js';
import { UserModel } from '../users/user.model.js';
import { AuditLogModel } from './audit-log.model.js';

const NOISE = new Set(['_id', 'updatedAt', 'createdAt', 'version', 'searchTokens', 'phoneticKeys', 'generation', 'updatedBy', 'familyId', 'createdBy']);
const RESTORABLE = new Set(['member.update', 'member.delete', 'relationship.delete']);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Removes database-only keys (ids, derived sort keys) so earlier values can be validated again. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Types.ObjectId)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k, v]) => k !== '_id' && k !== 'sortKey' && v !== null && v !== undefined)
        .map(([k, v]) => [k, clean(v)]),
    );
  }
  return value;
}

/** Reading the audit trail and restoring earlier versions (administrators only). */
export class AuditReadService {
  constructor(
    private readonly members: MembersService,
    private readonly relationships: RelationshipsService,
  ) {}

  async list(access: FamilyAccess, query: Pagination & { targetType?: string; targetId?: string; action?: string }) {
    access.assert('audit.view');
    const filter: Record<string, unknown> = { familyId: access.familyId };
    if (query.targetType) filter['targetType'] = query.targetType;
    if (query.targetId) filter['targetId'] = new Types.ObjectId(query.targetId);
    if (query.action) filter['action'] = { $regex: `^${query.action.replace(/[^a-z._]/g, '')}` };
    const [rows, total] = await Promise.all([
      AuditLogModel.find(filter).sort({ at: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean(),
      AuditLogModel.countDocuments(filter),
    ]);

    const actorIds = [...new Set(rows.map((r) => r.actorId?.toString()).filter(Boolean))].map((x) => new Types.ObjectId(x));
    const memberIds = rows.filter((r) => r.targetType === 'member' && r.targetId).map((r) => r.targetId!);
    const edgeIds = rows.filter((r) => r.targetType === 'relationship' && r.targetId).map((r) => r.targetId!);
    const [users, people, edges] = await Promise.all([
      UserModel.find({ _id: { $in: actorIds } }, { displayName: 1 }).lean(),
      FamilyMemberModel.find({ _id: { $in: memberIds }, familyId: access.familyId }, { firstName: 1, preferredName: 1, surname: 1, deletedAt: 1 }).lean(),
      RelationshipModel.find({ _id: { $in: edgeIds }, familyId: access.familyId }, { deletedAt: 1, personA: 1, personB: 1 }).lean(),
    ]);
    const edgePeople = await FamilyMemberModel.find({ _id: { $in: edges.flatMap((e) => [e.personA, e.personB]) }, familyId: access.familyId }, { firstName: 1, preferredName: 1, surname: 1 }).lean();
    const name = (id: Types.ObjectId) => {
      const p = [...people, ...edgePeople].find((x) => x._id.equals(id));
      return p ? displayName(p) : null;
    };

    const data: AuditEntryView[] = rows.map((r) => {
      const before = (r.before ?? {}) as Record<string, unknown>;
      const after = (r.after ?? {}) as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !NOISE.has(k));
      const changes = r.action.endsWith('.update') ? keys.filter((k) => !same(before[k], after[k])).map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null })) : [];
      let targetName: string | null = null;
      let restorable = false;
      if (r.targetType === 'member' && r.targetId) {
        targetName = name(r.targetId);
        const person = people.find((p) => p._id.equals(r.targetId!));
        restorable = RESTORABLE.has(r.action) && !!person && (r.action === 'member.delete' ? !!person.deletedAt : !person.deletedAt);
      } else if (r.targetType === 'relationship' && r.targetId) {
        const e = edges.find((x) => x._id.equals(r.targetId!));
        targetName = e ? `${name(e.personA) ?? '?'} – ${name(e.personB) ?? '?'}` : null;
        restorable = r.action === 'relationship.delete' && !!e?.deletedAt;
      } else if (['media', 'story', 'event'].includes(r.targetType)) {
        // Archive entries carry the title they had at the time.
        const title = (after['title'] ?? before['title']) as string | undefined;
        targetName = typeof title === 'string' ? title : null;
      }
      return {
        id: r._id.toString(),
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId?.toString() ?? null,
        targetName,
        actor: r.actorId ? { id: r.actorId.toString(), displayName: users.find((u) => u._id.equals(r.actorId!))?.displayName ?? 'Former member' } : null,
        actorRole: r.actorRole,
        contributionId: r.contributionId?.toString() ?? null,
        changes,
        at: r.at.toISOString(),
        restorable,
      };
    });
    return { data, meta: pageMeta(query, total) };
  }

  /**
   * Restores what an audit entry changed: the earlier values of an edit, a removed person (with the
   * links removed with them) or a removed link. The restore is itself a new, audited change.
   */
  async restore(access: FamilyAccess, actor: Actor, auditId: Types.ObjectId): Promise<RestoreResult> {
    access.assert('record.restore');
    const entry = await AuditLogModel.findOne({ _id: auditId, familyId: access.familyId });
    if (!entry?.targetId) throw AppError.notFound('History entry');
    switch (entry.action) {
      case 'member.update': {
        const before = (entry.before ?? {}) as Record<string, unknown>;
        const after = (entry.after ?? {}) as Record<string, unknown>;
        const editable = Object.keys(memberPatch.shape);
        const changed = editable.filter((k) => !same(before[k], after[k]));
        const values = Object.fromEntries(changed.map((k) => [k, before[k] === undefined ? null : clean(before[k])]));
        const parsed = memberPatch.safeParse(values);
        if (!parsed.success || changed.length === 0) throw new AppError('CONFLICT', 'This change cannot be restored automatically. Edit the profile instead.');
        const doc = await FamilyMemberModel.findOne({ _id: entry.targetId, familyId: access.familyId, deletedAt: null });
        if (!doc) throw new AppError('CONFLICT', 'This person has been removed. Restore them first.');
        await this.members.update(access, actor, entry.targetId, { ...parsed.data, version: doc.get('version') as number });
        return { restored: entry.targetId.toString(), relationshipsRestored: 0, relationshipsSkipped: 0 };
      }
      case 'member.delete':
        return this.members.restore(access, actor, entry.targetId);
      case 'relationship.delete':
        await this.relationships.restore(access, actor, entry.targetId);
        return { restored: entry.targetId.toString(), relationshipsRestored: 1, relationshipsSkipped: 0 };
      default:
        throw new AppError('CONFLICT', 'This kind of change cannot be restored automatically.');
    }
  }
}
