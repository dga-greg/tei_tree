import { Queue } from 'bullmq';
import { Types } from 'mongoose';
import type { Logger } from '../../core/logger.js';
import { QUEUE_NAMES } from '../../infra/queues.js';
import type { Redis } from '../../infra/redis.js';
import type { StorageProvider } from '../../infra/storage.js';
import type { Transcriber } from '../../infra/transcriber.js';
import { searchTextOf } from '../archive/archive.shared.js';
import type { AuditService } from '../audit/audit.service.js';
import { FamilyMediaModel, type FamilyMediaDoc } from './media.model.js';

export interface TranscriptionJob {
  mediaId: string;
  /** Also produce an English translation. */
  translate: boolean;
}

/** Words of a file that search looks through: title, description, file name, and what is said in it. */
export function mediaSearchText(m: Pick<FamilyMediaDoc, 'title' | 'description' | 'originalName' | 'transcript'>): string {
  return searchTextOf(m.title, m.description, m.originalName, m.transcript?.text?.slice(0, 20_000), m.transcript?.translation?.text?.slice(0, 20_000));
}

/**
 * Automatic transcripts. A request marks the recording "pending"; the work runs in the worker when Redis is
 * configured, otherwise in the background of the API process. The recording never leaves the server except
 * to the configured speech-to-text service.
 */
export class TranscriptionService {
  private readonly queue: Queue<TranscriptionJob> | null;
  /** Inline runs in progress (no Redis), so tests and shutdown can wait for them. */
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly storage: StorageProvider,
    readonly transcriber: Transcriber,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    redis?: Redis,
  ) {
    this.queue = redis ? new Queue<TranscriptionJob>(QUEUE_NAMES.transcriptions, { connection: redis }) : null;
  }

  async request(job: TranscriptionJob): Promise<void> {
    if (this.queue) {
      await this.queue.add('transcribe', job, { deduplication: { id: `tr-${job.mediaId}` }, attempts: 2, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 100, removeOnFail: 500 });
      return;
    }
    const run = this.process(job).finally(() => this.running.delete(run));
    this.running.add(run);
  }

  async idle(): Promise<void> {
    await Promise.all([...this.running]);
  }

  async process(job: TranscriptionJob): Promise<void> {
    const m = await FamilyMediaModel.findOne({ _id: new Types.ObjectId(job.mediaId), deletedAt: null });
    if (!m || !['audio', 'video'].includes(m.kind)) return;
    try {
      const file = await this.storage.read(m.storageKey);
      const result = await this.transcriber.transcribe(file, m.originalName || `${m.title}`, m.mimeType, false);
      const translation = job.translate ? await this.transcriber.transcribe(file, m.originalName || m.title, m.mimeType, true) : null;
      // Someone may have typed a transcript meanwhile: theirs wins.
      const fresh = await FamilyMediaModel.findById(m._id);
      if (!fresh || fresh.transcript?.source === 'typed') return;
      fresh.set('transcript', {
        status: 'done',
        text: result.text.slice(0, 200_000),
        language: result.language ?? fresh.transcript?.language ?? '',
        source: 'automatic',
        translation: translation ? { text: translation.text.slice(0, 200_000), language: 'English' } : null,
        error: null,
        updatedAt: new Date(),
      });
      fresh.searchText = mediaSearchText(fresh);
      await fresh.save();
      await this.audit.record({ familyId: fresh.familyId, actorId: null, actorRole: 'system', action: 'media.transcribe', targetType: 'media', targetId: fresh._id, after: { characters: result.text.length, translated: !!translation } });
    } catch (err) {
      this.logger.warn({ err, mediaId: job.mediaId }, 'Transcription failed');
      await FamilyMediaModel.updateOne(
        { _id: m._id, 'transcript.status': 'pending' },
        { $set: { 'transcript.status': 'failed', 'transcript.error': (err instanceof Error ? err.message : 'The transcription failed').slice(0, 500), 'transcript.updatedAt': new Date() } },
      );
    }
  }

  async close(): Promise<void> {
    await this.queue?.close();
  }
}
