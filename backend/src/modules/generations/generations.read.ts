import { Types } from 'mongoose';
import { BIRTH_ERAS, birthEraOf, type FamilyDashboard, type GenerationConflictView, type GenerationState, type GenerationSummary, type GenerationTrendPoint } from '@fh/contracts';
import { iso } from '../../core/dates.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { GenerationSnapshotModel } from './generation-snapshot.model.js';
import { FamilyBranchModel } from '../branches/branch.model.js';

/**
 * Read models for generation statistics and the family dashboard. Members only: the figures
 * include counts of living people.
 */
export class GenerationsReadService {
  /** @param openContributions counts proposals waiting on the viewer (Phase 6). */
  constructor(private readonly openContributions: (access: FamilyAccess) => Promise<number> = async () => 0) {}

  private async state(familyId: Types.ObjectId): Promise<GenerationState> {
    const f = await FamilyModel.findById(familyId, { generationState: 1 }).lean();
    return { status: f?.generationState?.status ?? 'idle', completedAt: iso(f?.generationState?.completedAt) };
  }

  private latest(familyId: Types.ObjectId) {
    return GenerationSnapshotModel.findOne({ familyId }).sort({ computedAt: -1 }).lean();
  }

  async summary(access: FamilyAccess): Promise<GenerationSummary> {
    access.assert('member.view');
    const policy = new MemberPolicy(access);
    const [snapshot, state] = await Promise.all([this.latest(access.familyId), this.state(access.familyId)]);
    const founderId = access.family.foundingMemberId;
    const founder = founderId ? await FamilyMemberModel.findOne({ _id: founderId, familyId: access.familyId, deletedAt: null }) : null;
    return {
      state,
      founder: founder ? toPersonCard(founder, policy) : null,
      computedAt: iso(snapshot?.computedAt),
      totals: snapshot?.totals ? { ...snapshot.totals } : { members: 0, generations: 0, conflicts: 0, unconnected: 0, marriedIn: 0 },
      byGeneration: (snapshot?.byGeneration ?? []).map((b) => ({ ...b, earliestBirthYear: b.earliestBirthYear ?? null, latestBirthYear: b.latestBirthYear ?? null })),
      ...(await this.eras(access, policy)),
    };
  }

  /** Everyone the viewer may see, by era of birth, from the birth dates the viewer may see. */
  private async eras(access: FamilyAccess, policy: MemberPolicy): Promise<Pick<GenerationSummary, 'byEra' | 'eraUnknown'>> {
    const people = await FamilyMemberModel.find({ familyId: access.familyId, deletedAt: null });
    const counts = new Map<string, number>();
    let unknown = 0;
    for (const p of people) {
      if (!policy.isVisible(p)) continue;
      const era = birthEraOf(toPersonCard(p, policy).birthDate);
      if (era) counts.set(era.key, (counts.get(era.key) ?? 0) + 1);
      else unknown++;
    }
    return { byEra: BIRTH_ERAS.filter((e) => counts.has(e.key)).map((e) => ({ era: e.key, count: counts.get(e.key)! })), eraUnknown: unknown };
  }

  /** One point per day (the day's last recalculation) over the past year. */
  async trend(access: FamilyAccess): Promise<GenerationTrendPoint[]> {
    access.assert('member.view');
    const since = new Date(Date.now() - 365 * 86_400_000);
    const rows = await GenerationSnapshotModel.aggregate<{ _id: string; members: number; generations: number }>([
      { $match: { familyId: access.familyId, computedAt: { $gte: since } } },
      { $sort: { computedAt: 1 } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$computedAt' } },
          members: { $last: '$totals.members' },
          generations: { $last: '$totals.generations' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({ date: r._id, members: r.members, generations: r.generations }));
  }

  async conflicts(access: FamilyAccess): Promise<GenerationConflictView[]> {
    access.assert('member.view');
    const policy = new MemberPolicy(access);
    const people = await FamilyMemberModel.find({
      familyId: access.familyId,
      deletedAt: null,
      $or: [{ 'generation.status': 'conflict' }, { 'generation.override': { $ne: null } }],
    }).sort({ surname: 1, firstName: 1 });
    return people.map((p) => {
      const o = p.generation?.override;
      return {
        person: toPersonCard(p, policy),
        candidates: [...(p.generation?.candidates ?? [])],
        resolution: o && p.generation?.status === 'computed' ? { number: o.number, reason: o.reason, at: o.at.toISOString() } : null,
      };
    });
  }

  async dashboard(access: FamilyAccess): Promise<FamilyDashboard> {
    access.assert('member.view');
    const policy = new MemberPolicy(access);
    const familyId = access.familyId;
    const yearAgo = new Date();
    yearAgo.setUTCMonth(yearAgo.getUTCMonth() - 11, 1);
    yearAgo.setUTCHours(0, 0, 0, 0);

    const [snapshot, state, recent, growthRows, counts, branchCount, pending] = await Promise.all([
      this.latest(familyId),
      this.state(familyId),
      FamilyMemberModel.find({ familyId, deletedAt: null }).sort({ createdAt: -1 }).limit(6),
      FamilyMemberModel.aggregate<{ _id: string; n: number }>([
        { $match: { familyId, deletedAt: null, createdAt: { $gte: yearAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, n: { $sum: 1 } } },
      ]),
      FamilyMemberModel.aggregate<{ total: number; living: number; deceased: number; conflicts: number }>([
        { $match: { familyId, deletedAt: null } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            living: { $sum: { $cond: [{ $eq: ['$vitalStatus', 'living'] }, 1, 0] } },
            deceased: { $sum: { $cond: [{ $eq: ['$vitalStatus', 'deceased'] }, 1, 0] } },
            conflicts: { $sum: { $cond: [{ $eq: ['$generation.status', 'conflict'] }, 1, 0] } },
          },
        },
      ]),
      FamilyBranchModel.countDocuments({ familyId, deletedAt: null }),
      this.openContributions(access),
    ]);

    const byMonth = new Map(growthRows.map((r) => [r._id, r.n]));
    const growth: FamilyDashboard['growth'] = [];
    const cursor = new Date(yearAgo);
    for (let i = 0; i < 12; i++) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      growth.push({ month: key, added: byMonth.get(key) ?? 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const c = counts[0];
    return {
      stats: {
        members: c?.total ?? 0,
        generations: snapshot?.totals?.generations ?? 0,
        living: c?.living ?? 0,
        deceased: c?.deceased ?? 0,
        branches: branchCount,
        pendingContributions: pending,
        conflicts: c?.conflicts ?? 0,
      },
      byGeneration: (snapshot?.byGeneration ?? []).map((b) => ({ ...b, earliestBirthYear: b.earliestBirthYear ?? null, latestBirthYear: b.latestBirthYear ?? null })),
      recentlyAdded: recent.filter((p) => policy.isVisible(p)).map((p) => toPersonCard(p, policy)),
      growth,
      state,
    };
  }
}
