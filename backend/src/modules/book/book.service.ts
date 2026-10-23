import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { z } from 'zod';
import { BOOK_LABELS, BOOK_SCOPES, PAPER_SIZES, type BookOptions, type BookView } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import { objectId } from '../../core/validation.js';
import { QUEUE_NAMES } from '../../infra/queues.js';
import type { Redis } from '../../infra/redis.js';
import type { StorageProvider } from '../../infra/storage.js';
import type { AuditService } from '../audit/audit.service.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import { resolveFamilyAccess, type FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { MemberPolicy } from '../members/member.policy.js';
import type { Actor } from '../relationships/relationships.service.js';
import { assembleBook } from './book.data.js';
import { FamilyBookModel, type FamilyBookDoc } from './book.model.js';
import { renderBook } from './book.render.js';

const labelKeys = Object.keys(BOOK_LABELS) as [keyof typeof BOOK_LABELS, ...(keyof typeof BOOK_LABELS)[]];
export const bookRequestBody = z
  .object({
    scope: z.enum(BOOK_SCOPES),
    branchId: objectId.nullable().optional(),
    personId: objectId.nullable().optional(),
    generations: z.number().int().min(1).max(12).default(3),
    title: z.string().trim().max(120).optional(),
    subtitle: z.string().trim().max(200).optional(),
    include: z
      .object({ tree: z.boolean().default(true), people: z.boolean().default(true), stories: z.boolean().default(true), timeline: z.boolean().default(true), photos: z.boolean().default(true) })
      .strict()
      .default({ tree: true, people: true, stories: true, timeline: true, photos: true }),
    living: z.enum(['names', 'full']).default('names'),
    paper: z.enum(PAPER_SIZES).default('A4'),
    locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).max(35).optional(),
    labels: z.partialRecord(z.enum(labelKeys), z.string().trim().max(200)).optional(),
  })
  .strict()
  .refine((b) => b.scope !== 'branch' || !!b.branchId, { path: ['branchId'], message: 'Choose a branch' })
  .refine((b) => b.scope !== 'person' || !!b.personId, { path: ['personId'], message: 'Choose a person' });

/** Books kept per person and family; older ones are removed. */
const KEEP = 10;
const STALE_MS = 60 * 60 * 1000;

interface BookJob {
  bookId: string;
}

/**
 * Printable family books. A request is checked and queued; the worker gathers what the person may see, lays out
 * the PDF and stores it. Each person sees only their own books: a book holds what its maker could see.
 */
export class BookService {
  private readonly queue: Queue<BookJob> | null;
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly storage: StorageProvider,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    redis?: Redis,
  ) {
    this.queue = redis ? new Queue<BookJob>(QUEUE_NAMES.books, { connection: redis }) : null;
  }

  private assertMember(access: FamilyAccess): void {
    if (!access.membership) throw AppError.forbidden('Family books are for members of the family');
  }

  private toView(access: FamilyAccess, b: FamilyBookDoc): BookView {
    return {
      id: b.id as string,
      title: b.title,
      options: b.options as BookOptions,
      status: b.status,
      progress: b.progress,
      pages: b.pages ?? null,
      people: b.people ?? null,
      sizeBytes: b.sizeBytes ?? null,
      error: b.error ?? null,
      createdAt: b.get('createdAt').toISOString(),
      finishedAt: b.finishedAt?.toISOString() ?? null,
      downloadUrl: b.status === 'done' ? `/api/v1/families/${access.familyId.toString()}/books/${b.id as string}/download` : null,
    };
  }

  private async load(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<FamilyBookDoc> {
    const b = await FamilyBookModel.findOne({ _id: id, familyId: access.familyId, requestedBy: actor.userId });
    if (!b) throw AppError.notFound('Book');
    return b;
  }

  async list(access: FamilyAccess, actor: Actor): Promise<BookView[]> {
    this.assertMember(access);
    const books = await FamilyBookModel.find({ familyId: access.familyId, requestedBy: actor.userId }).sort({ createdAt: -1 }).limit(KEEP);
    return books.map((b) => this.toView(access, b));
  }

  async get(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<BookView> {
    this.assertMember(access);
    return this.toView(access, await this.load(access, actor, id));
  }

  async request(access: FamilyAccess, actor: Actor, body: z.output<typeof bookRequestBody>): Promise<BookView> {
    this.assertMember(access);
    const policy = new MemberPolicy(access);
    let title = body.title || access.family.name;
    if (body.scope === 'branch') {
      const branch = await FamilyBranchModel.findOne({ _id: body.branchId, familyId: access.familyId, deletedAt: null });
      if (!branch) throw AppError.notFound('Branch');
      title = body.title || branch.name;
    }
    if (body.scope === 'person') {
      const person = await FamilyMemberModel.findOne({ _id: body.personId, familyId: access.familyId, deletedAt: null });
      if (!person || !policy.isVisible(person)) throw AppError.notFound('Person');
      title = body.title || [person.firstName, person.surname].filter(Boolean).join(' ');
    }
    // One book at a time per person (a stuck one gives way after an hour).
    const busy = await FamilyBookModel.exists({ familyId: access.familyId, requestedBy: actor.userId, status: { $in: ['queued', 'running'] }, createdAt: { $gt: new Date(Date.now() - STALE_MS) } });
    if (busy) throw new AppError('CONFLICT', 'Your previous book is still being made. Wait for it to finish, then ask for another.');
    const options: BookOptions = { ...body, branchId: body.branchId ?? null, personId: body.personId ?? null };
    const book = await FamilyBookModel.create({ familyId: access.familyId, requestedBy: actor.userId, title, options });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'book.create', targetType: 'book', targetId: book._id, after: { scope: body.scope, living: body.living }, requestId: actor.requestId, ip: actor.ip });
    await this.enqueue({ bookId: book.id as string });
    return this.toView(access, book);
  }

  private async enqueue(job: BookJob): Promise<void> {
    if (this.queue) {
      await this.queue.add('make', job, { attempts: 1, removeOnComplete: 100, removeOnFail: 200 });
      return;
    }
    const run = this.process(job).finally(() => this.running.delete(run));
    this.running.add(run);
  }

  async idle(): Promise<void> {
    await Promise.all([...this.running]);
  }

  async close(): Promise<void> {
    await this.idle();
    await this.queue?.close();
  }

  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    this.assertMember(access);
    const b = await this.load(access, actor, id);
    if (b.status === 'running') throw new AppError('CONFLICT', 'This book is being made. Remove it once it is finished.');
    await this.discard(b);
  }

  private async discard(b: FamilyBookDoc): Promise<void> {
    if (b.storageKey) await this.storage.remove(b.storageKey).catch((err: unknown) => this.logger.warn({ err, bookId: b.id }, 'Could not remove a book file'));
    await FamilyBookModel.deleteOne({ _id: b._id });
  }

  /** A short-lived link to the PDF. */
  async downloadUrl(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<string> {
    this.assertMember(access);
    const b = await this.load(access, actor, id);
    if (b.status !== 'done' || !b.storageKey) throw new AppError('CONFLICT', 'This book is not ready yet');
    const name = `${b.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Family book'}.pdf`;
    return this.storage.signedUrl(b.storageKey, { contentType: 'application/pdf', disposition: 'attachment', filename: name });
  }

  /** Makes the book (worker, or inline without Redis). */
  async process(job: BookJob): Promise<void> {
    const book = await FamilyBookModel.findOneAndUpdate({ _id: job.bookId, status: 'queued' }, { $set: { status: 'running', startedAt: new Date(), progress: 1 } }, { new: true });
    if (!book) return;
    const dir = await mkdtemp(join(tmpdir(), 'fh-book-'));
    let lastSaved = 0;
    const progress = (fraction: number) => {
      const value = Math.max(1, Math.min(99, Math.round(fraction * 100)));
      if (value - lastSaved < 5) return;
      lastSaved = value;
      void FamilyBookModel.updateOne({ _id: book._id, status: 'running' }, { $set: { progress: value } }).catch(() => undefined);
    };
    try {
      const access = await resolveFamilyAccess(book.familyId, book.requestedBy);
      if (!access?.membership) throw new Error('You are no longer a member of this family');
      const options = book.options as BookOptions;
      const data = await assembleBook(access, options, this.storage, (f) => progress(f * 0.6));
      const file = join(dir, 'book.pdf');
      const { pages } = await renderBook(data, file, (f) => progress(0.6 + f * 0.38));
      const key = `families/${book.familyId.toString()}/books/${book.id as string}.pdf`;
      await this.storage.putFile(key, file, 'application/pdf');
      const { size } = await stat(file);
      await FamilyBookModel.updateOne({ _id: book._id }, { $set: { status: 'done', progress: 100, storageKey: key, sizeBytes: size, pages, people: data.people.length, finishedAt: new Date() } });
      await this.prune(book.familyId, book.requestedBy);
    } catch (err) {
      this.logger.error({ err, bookId: book.id }, 'Family book failed');
      await FamilyBookModel.updateOne({ _id: book._id }, { $set: { status: 'failed', error: (err as Error).message?.slice(0, 500) || 'The book could not be made', finishedAt: new Date() } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async prune(familyId: Types.ObjectId, userId: Types.ObjectId): Promise<void> {
    const old = await FamilyBookModel.find({ familyId, requestedBy: userId, status: { $in: ['done', 'failed'] } }).sort({ createdAt: -1 }).skip(KEEP);
    for (const b of old) await this.discard(b);
  }
}
