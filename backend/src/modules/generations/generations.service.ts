import { Types } from 'mongoose';
import type { Logger } from '../../core/logger.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { GenerationSnapshotModel } from './generation-snapshot.model.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import { computeGenerations, type EngineOutput } from './generation-engine.js';

/**
 * Loads a family's graph, runs the generation engine and writes back only what changed.
 * A family is never recalculated twice at the same time by this process; requests that arrive
 * during a run trigger exactly one follow-up run (see `run`).
 */
export class GenerationsService {
  private readonly running = new Map<string, Promise<void>>();

  constructor(private readonly logger: Logger) {}

  /** Recomputes now and resolves when the family's generation numbers are current. */
  async recalculate(familyId: Types.ObjectId): Promise<void> {
    const key = familyId.toString();
    await FamilyModel.updateOne({ _id: familyId }, { $set: { 'generationState.status': 'pending', 'generationState.requestedAt': new Date() } });
    const inFlight = this.running.get(key);
    if (inFlight) {
      // The running pass will notice the newer request and loop once more.
      await inFlight;
      return;
    }
    const run = this.run(familyId).finally(() => this.running.delete(key));
    this.running.set(key, run);
    await run;
  }

  private async run(familyId: Types.ObjectId): Promise<void> {
    for (let pass = 0; pass < 5; pass++) {
      const startedAt = new Date();
      const family = await FamilyModel.findOneAndUpdate(
        { _id: familyId },
        { $set: { 'generationState.status': 'running', 'generationState.startedAt': startedAt } },
        { new: true },
      );
      if (!family) return;
      await this.computeAndStore(family._id, family.foundingMemberId ?? null, family.generationPolicy?.countAdoptive ?? true);
      // Finish only if no change was requested while we were computing.
      const finished = await FamilyModel.updateOne(
        { _id: familyId, 'generationState.requestedAt': { $lte: startedAt } },
        { $set: { 'generationState.status': 'idle', 'generationState.completedAt': new Date() } },
      );
      if (finished.matchedCount === 1) return;
    }
    this.logger.warn({ familyId: familyId.toString() }, 'Generation recalculation kept being re-requested; will continue on the next change');
  }

  async computeAndStore(familyId: Types.ObjectId, founderId: Types.ObjectId | null, countAdoptive: boolean): Promise<EngineOutput> {
    const started = Date.now();
    const [people, edges] = await Promise.all([
      FamilyMemberModel.find({ familyId, deletedAt: null }, { vitalStatus: 1, 'birthDate.year': 1, generation: 1 }).lean(),
      RelationshipModel.find({ familyId, deletedAt: null }, { type: 1, personA: 1, personB: 1, subtype: 1, verification: 1 }).lean(),
    ]);

    const out = computeGenerations({
      founderId: founderId?.toString() ?? null,
      people: people.map((p) => ({
        id: p._id.toString(),
        vitalStatus: p.vitalStatus,
        birthYear: p.birthDate?.year ?? null,
        override: p.generation?.override?.number ?? null,
      })),
      descent: edges
        .filter((e) => e.type === 'parent_child')
        .map((e) => ({ parent: e.personA.toString(), child: e.personB.toString(), subtype: e.subtype, verification: e.verification })),
      partnerships: edges.filter((e) => e.type === 'partnership').map((e) => [e.personA.toString(), e.personB.toString()] as [string, string]),
      countAdoptive,
    });

    const now = new Date();
    const ops = [];
    for (const p of people) {
      const r = out.results.get(p._id.toString())!;
      const g = p.generation;
      const same =
        g?.number === r.number &&
        g?.status === r.status &&
        JSON.stringify(g?.candidates ?? []) === JSON.stringify(r.candidates);
      if (same) continue;
      ops.push({
        updateOne: {
          filter: { _id: p._id, familyId },
          update: { $set: { 'generation.number': r.number, 'generation.status': r.status, 'generation.candidates': r.candidates, 'generation.computedAt': now } },
        },
      });
    }
    if (ops.length) await FamilyMemberModel.bulkWrite(ops, { ordered: false });

    const branchCount = await this.storeBranchStats(familyId, out, people, edges, countAdoptive, now);
    const living = people.filter((p) => p.vitalStatus === 'living').length;
    const deceased = people.filter((p) => p.vitalStatus === 'deceased').length;
    await Promise.all([
      GenerationSnapshotModel.create({
        familyId,
        founderId,
        computedAt: now,
        durationMs: Date.now() - started,
        totals: {
          members: out.totals.members,
          generations: out.totals.generations,
          conflicts: out.totals.conflicts,
          unconnected: out.totals.unconnected,
          marriedIn: out.totals.marriedIn,
        },
        byGeneration: out.byGeneration,
      }),
      FamilyModel.updateOne(
        { _id: familyId },
        {
          $set: {
            'stats.memberCount': people.length,
            'stats.livingCount': living,
            'stats.deceasedCount': deceased,
            'stats.generationCount': out.totals.generations,
            'stats.branchCount': branchCount,
            'stats.recalculatedAt': now,
          },
        },
      ),
    ]);
    if (out.cycle.length) {
      this.logger.error({ familyId: familyId.toString(), people: out.cycle }, 'Parent-child cycle found in stored data; affected people left unnumbered');
    }
    this.logger.debug({ familyId: familyId.toString(), changed: ops.length, ms: Date.now() - started }, 'Generations recalculated');
    return out;
  }

  /**
   * Branch statistics from the same graph and the same descent rule as generation numbers:
   * descendants of each branch's founding member (a person may count in several branches).
   */
  private async storeBranchStats(
    familyId: Types.ObjectId,
    out: EngineOutput,
    people: { _id: Types.ObjectId; vitalStatus: string }[],
    edges: { type: string; personA: Types.ObjectId; personB: Types.ObjectId; subtype: string; verification: string }[],
    countAdoptive: boolean,
    now: Date,
  ): Promise<number> {
    const branches = await FamilyBranchModel.find({ familyId, deletedAt: null }, { foundingMemberId: 1 }).lean();
    if (!branches.length) return 0;
    const children = new Map<string, string[]>();
    for (const e of edges) {
      if (e.type !== 'parent_child' || e.verification !== 'verified') continue;
      if (!(e.subtype === 'biological' || (countAdoptive && e.subtype === 'adoptive'))) continue;
      const p = e.personA.toString();
      children.set(p, [...(children.get(p) ?? []), e.personB.toString()]);
    }
    const living = new Set(people.filter((p) => p.vitalStatus === 'living').map((p) => p._id.toString()));
    const present = new Set(people.map((p) => p._id.toString()));
    await FamilyBranchModel.bulkWrite(
      branches.map((b) => {
        const root = b.foundingMemberId.toString();
        const seen = new Set([root]);
        const queue = [root];
        while (queue.length) {
          for (const c of children.get(queue.shift()!) ?? []) {
            if (!seen.has(c) && present.has(c)) {
              seen.add(c);
              queue.push(c);
            }
          }
        }
        const numbers = [...seen].map((id) => out.results.get(id)?.number).filter((n): n is number => n != null);
        const span = numbers.length ? Math.max(...numbers) - Math.min(...numbers) + 1 : 0;
        return {
          updateOne: {
            filter: { _id: b._id },
            update: {
              $set: {
                'stats.descendantCount': present.has(root) ? seen.size - 1 : 0,
                'stats.generationSpan': span,
                'stats.livingCount': [...seen].filter((id) => living.has(id)).length,
                'stats.recalculatedAt': now,
              },
            },
          },
        };
      }),
    );
    return branches.length;
  }
}
