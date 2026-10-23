import type { Types } from 'mongoose';
import type { Logger } from '../../core/logger.js';
import { FamilyModel } from '../families/family.model.js';
import { assignFamilyCodes } from '../members/family-code.js';
import type { GenerationsService } from './generations.service.js';

/**
 * Decides where a recalculation runs. Called after the transaction that changed the graph has
 * committed, so the engine always reads committed data.
 *
 * Everything runs in the API process: small families within the request, large ones in the background
 * (one run at a time per family; edits that arrive during a run trigger one more run when it ends).
 */
export class GenerationScheduler {
  /** Families with a background run in progress, and whether another run is wanted after it. */
  private readonly running = new Map<string, { again: boolean; done: Promise<void> }>();

  constructor(
    private readonly generations: GenerationsService,
    private readonly logger: Logger,
    /** Families up to this size are recalculated within the request; larger ones in the background. */
    private readonly inlineLimit = 2000,
    /** Wait before a background run, so a burst of edits is recalculated once. */
    private readonly backgroundDelayMs = 1500,
  ) {}

  async request(familyId: Types.ObjectId): Promise<void> {
    // Family IDs are given at once, in the request, so the answer already shows them.
    try {
      await assignFamilyCodes(familyId);
    } catch (err) {
      this.logger.error({ err, familyId: familyId.toString() }, 'Giving family IDs failed');
    }
    const family = await FamilyModel.findById(familyId, { 'stats.memberCount': 1 });
    if (!family) return;
    const size = family.stats?.memberCount ?? 0;
    if (size <= this.inlineLimit) {
      await this.recalculate(familyId);
      return;
    }
    await FamilyModel.updateOne({ _id: familyId }, { $set: { 'generationState.status': 'pending', 'generationState.requestedAt': new Date() } });
    this.background(familyId);
  }

  private async recalculate(familyId: Types.ObjectId): Promise<void> {
    try {
      await this.generations.recalculate(familyId);
    } catch (err) {
      // The change itself is committed; numbers are fixed by the next successful run.
      this.logger.error({ err, familyId: familyId.toString() }, 'Generation recalculation failed');
    }
  }

  private background(familyId: Types.ObjectId): void {
    const key = familyId.toString();
    const current = this.running.get(key);
    if (current) {
      current.again = true;
      return;
    }
    const entry = { again: false, done: Promise.resolve() };
    entry.done = (async () => {
      do {
        entry.again = false;
        await new Promise((r) => setTimeout(r, this.backgroundDelayMs).unref());
        await this.recalculate(familyId);
      } while (entry.again);
      this.running.delete(key);
    })();
    this.running.set(key, entry);
  }

  /** Waits for background runs in progress (on shutdown, and in tests). */
  async close(): Promise<void> {
    await Promise.allSettled([...this.running.values()].map((r) => r.done));
  }
}
