import { Queue } from 'bullmq';
import type { Types } from 'mongoose';
import type { Logger } from '../../core/logger.js';
import type { Redis } from '../../infra/redis.js';
import { QUEUE_NAMES } from '../../infra/queues.js';
import { FamilyModel } from '../families/family.model.js';
import { assignFamilyCodes } from '../members/family-code.js';
import type { GenerationsService } from './generations.service.js';

export interface GenerationJob {
  familyId: string;
}


/**
 * Decides where a recalculation runs. Called after the transaction that changed the graph has
 * committed, so the engine always reads committed data.
 */
export class GenerationScheduler {
  private readonly queue: Queue<GenerationJob> | null;

  constructor(
    private readonly generations: GenerationsService,
    private readonly logger: Logger,
    redis?: Redis,
    /** Families up to this size are recalculated within the request; larger ones by the worker. */
    private readonly inlineLimit = 2000,
  ) {
    this.queue = redis ? new Queue<GenerationJob>(QUEUE_NAMES.generations, { connection: redis }) : null;
  }

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
    if (!this.queue || size <= this.inlineLimit) {
      try {
        await this.generations.recalculate(familyId);
      } catch (err) {
        // The change itself is committed; numbers are fixed by the next successful run.
        this.logger.error({ err, familyId: familyId.toString() }, 'Inline generation recalculation failed');
      }
      return;
    }
    await FamilyModel.updateOne({ _id: familyId }, { $set: { 'generationState.status': 'pending', 'generationState.requestedAt': new Date() } });
    // One queued job per family absorbs bursts of edits; the worker loops if more changes arrive.
    await this.queue.add('recalculate', { familyId: familyId.toString() }, {
      deduplication: { id: `gen-${familyId.toString()}` },
      delay: 1500,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  async close(): Promise<void> {
    await this.queue?.close();
  }
}
