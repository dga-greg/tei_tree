import { readFile } from 'node:fs/promises';
import type { Request } from 'express';
import mongoose, { Types, type ClientSession } from 'mongoose';
import { z } from 'zod';
import {
  GEDCOM_MAX_MB,
  GEDCOM_MAX_PEOPLE,
  type GedcomImportPreview,
  type ImportBatchView,
  type ImportMatch,
  type ImportPersonPreview,
} from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { objectId, parse } from '../../core/validation.js';
import type { AuditService } from '../audit/audit.service.js';
import { blockingKeys, scoreMatch, type MatchCandidate } from '../duplicates/match.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyModel } from '../families/family.model.js';
import type { FamiliesService } from '../families/families.service.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import { UserModel } from '../users/user.model.js';
import { receiveUpload } from '../media/media.upload.js';
import { FamilyMemberModel, type FamilyMemberDoc } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { searchFields } from '../members/members.service.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import { noGraphListener, type Actor, type GraphChangeListener } from '../relationships/relationships.service.js';
import { parseGedcom, type ParsedGedcom, type ParsedPerson } from './gedcom-parser.js';
import { buildImportPlan, type ExistingGraph } from './import-plan.js';
import { FamilyImportModel } from './import.model.js';

const live = { deletedAt: null };
const MAX_MATCHES = 500;
const MAX_LISTED_WARNINGS = 200;

const decisionsSchema = z
  .object({
    same: z.record(z.string().min(1).max(40), objectId).default({}),
    fillBlanks: z.boolean().default(true),
    verifyLinks: z.boolean().default(true),
  })
  .strict();

/** Fields that "fill in blanks" may set on a person already in the family, when theirs is empty. */
const FILLABLE = ['middleNames', 'maidenName', 'gender', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'nationality', 'biography'] as const;

function previewOf(p: ParsedPerson): ImportPersonPreview {
  return {
    ref: p.ref,
    name: [p.title, p.firstName, p.middleNames, p.surname].filter(Boolean).join(' '),
    gender: p.gender,
    vitalStatus: p.vitalStatus,
    birthDate: p.birthDate,
    deathDate: p.deathDate,
    birthPlace: p.birthPlace,
  };
}

function isEmpty(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const d = value as { year?: unknown; text?: unknown };
    if ('qualifier' in d || 'sortKey' in d) return d.year == null && !d.text;
  }
  return false;
}

/** A GEDCOM file starts with a level-0 HEAD record (after an optional byte-order mark and blank lines). */
function looksLikeGedcom(bytes: Buffer): boolean {
  const start = bytes.subarray(0, 64);
  const text = start.includes(0) ? start.toString('utf16le').replace(/\0/g, '') + start.toString('latin1').replace(/\0/g, '') : start.toString('latin1');
  return /^\W{0,4}\s*0\s+HEAD\b/.test(text.replace(/^﻿|^ï»¿|^ÿþ|^þÿ/, ''));
}

export class ImportService {
  constructor(
    private readonly audit: AuditService,
    private readonly families: FamiliesService,
    private readonly graph: GraphChangeListener = noGraphListener,
  ) {}

  private async readFile(req: Request) {
    const upload = await receiveUpload(req, GEDCOM_MAX_MB * 1024 * 1024, { fieldSize: 2_000_000 });
    try {
      const bytes = await readFile(upload.file.path);
      if (!/\.ged(com)?$/i.test(upload.file.originalName) && !looksLikeGedcom(bytes)) {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Choose a GEDCOM file (.ged)', [{ path: 'file', message: 'Not a GEDCOM file' }]);
      }
      if (!looksLikeGedcom(bytes)) {
        throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'This file does not look like a GEDCOM file: it should start with "0 HEAD"', [{ path: 'file', message: 'Not a GEDCOM file' }]);
      }
      const parsed = parseGedcom(bytes);
      if (parsed.people.length === 0) throw new AppError('VALIDATION_FAILED', 'The file has no people in it', [{ path: 'file', message: 'No INDI records' }]);
      if (parsed.people.length > GEDCOM_MAX_PEOPLE) {
        throw new AppError('PAYLOAD_TOO_LARGE', `One import can add at most ${GEDCOM_MAX_PEOPLE.toLocaleString('en')} people; this file has ${parsed.people.length.toLocaleString('en')}`, [{ path: 'file', message: 'Too many people' }]);
      }
      return { parsed, fields: upload.fields, fileName: upload.file.originalName.slice(0, 255), sha256: upload.file.sha256 };
    } finally {
      await upload.cleanup();
    }
  }

  private async existingPeople(access: FamilyAccess, session?: ClientSession) {
    return FamilyMemberModel.find({ familyId: access.familyId, ...live }).session(session ?? null);
  }

  private async existingGraph(access: FamilyAccess, session?: ClientSession): Promise<ExistingGraph> {
    const edges = await RelationshipModel.find({ familyId: access.familyId, ...live }, { type: 1, personA: 1, personB: 1, subtype: 1 }).lean().session(session ?? null);
    return {
      parentLinks: edges.filter((e) => e.type === 'parent_child').map((e) => ({ parent: e.personA.toString(), child: e.personB.toString(), subtype: e.subtype })),
      partnerships: edges.filter((e) => e.type === 'partnership').map((e) => ({ a: e.personA.toString(), b: e.personB.toString() })),
    };
  }

  /** Best match in the family for each person in the file. */
  private findMatches(parsed: ParsedGedcom, people: FamilyMemberDoc[], policy: MemberPolicy): ImportMatch[] {
    const index = new Map<string, FamilyMemberDoc[]>();
    for (const m of people) {
      if (!policy.isVisible(m)) continue;
      for (const key of blockingKeys(m as unknown as MatchCandidate)) index.set(key, [...(index.get(key) ?? []), m]);
    }
    const matches: ImportMatch[] = [];
    for (const p of parsed.people) {
      const seen = new Set<string>();
      let best: { doc: FamilyMemberDoc; score: number; strength: ImportMatch['strength']; reasons: string[] } | null = null;
      for (const key of blockingKeys({ ...p, id: p.ref })) {
        for (const doc of index.get(key) ?? []) {
          if (seen.has(doc.id as string)) continue;
          seen.add(doc.id as string);
          const r = scoreMatch({ ...p, id: p.ref }, doc as unknown as MatchCandidate);
          if (r && (!best || r.score > best.score)) best = { doc, ...r };
        }
      }
      if (best) matches.push({ person: previewOf(p), existing: toPersonCard(best.doc, policy), score: best.score, strength: best.strength, reasons: best.reasons });
    }
    return matches.sort((a, b) => b.score - a.score).slice(0, MAX_MATCHES);
  }

  async preview(access: FamilyAccess, req: Request): Promise<GedcomImportPreview> {
    access.assert('family.import');
    const { parsed, fileName } = await this.readFile(req);
    const policy = new MemberPolicy(access);
    const [people, graph] = await Promise.all([this.existingPeople(access), this.existingGraph(access)]);
    const plan = buildImportPlan(parsed, graph, new Map());
    const warnings = [...parsed.warnings, ...plan.warnings];
    return {
      fileName,
      source: parsed.source,
      counts: { people: parsed.people.length, families: parsed.families, parentLinks: plan.parentLinks.length, partnerships: plan.partnerships.length },
      sample: parsed.people.slice(0, 100).map(previewOf),
      matches: this.findMatches(parsed, people, policy),
      warnings: warnings.slice(0, MAX_LISTED_WARNINGS),
      warningCount: warnings.length,
    };
  }

  async commit(access: FamilyAccess, actor: Actor, req: Request): Promise<ImportBatchView> {
    access.assert('family.import');
    const { parsed, fields, fileName, sha256 } = await this.readFile(req);
    let raw: unknown = {};
    try {
      raw = fields['decisions'] ? JSON.parse(fields['decisions']) : {};
    } catch {
      throw new AppError('VALIDATION_FAILED', 'The import choices could not be read', [{ path: 'decisions', message: 'Malformed JSON' }]);
    }
    const decisions = parse(decisionsSchema, raw);
    const refs = new Set(parsed.people.map((p) => p.ref));
    const same = new Map<string, string>();
    const used = new Set<string>();
    for (const [ref, memberId] of Object.entries(decisions.same)) {
      if (!refs.has(ref)) throw new AppError('VALIDATION_FAILED', `The file has no person ${ref}`, [{ path: `decisions.same.${ref}`, message: 'Unknown person in the file' }]);
      const id = String(memberId);
      if (used.has(id)) throw new AppError('VALIDATION_FAILED', 'Two people in the file cannot both be the same person in the family', [{ path: `decisions.same.${ref}`, message: 'Already matched to another person' }]);
      used.add(id);
      same.set(ref, id);
    }

    const result = await mongoose.connection.transaction(async (session) => {
      // Serialises with other changes to the family's links.
      await FamilyModel.updateOne({ _id: access.familyId }, { $inc: { graphRevision: 1 } }, { session });
      const matchedDocs = same.size ? await FamilyMemberModel.find({ _id: { $in: [...used].map((x) => new Types.ObjectId(x)) }, familyId: access.familyId, ...live }).session(session) : [];
      if (matchedDocs.length !== used.size) throw new AppError('VALIDATION_FAILED', 'Some of the people chosen as matches are no longer in the family. Preview the file again.', [{ path: 'decisions.same', message: 'Unknown family member' }]);
      const plan = buildImportPlan(parsed, await this.existingGraph(access, session), same);

      const [batch] = await FamilyImportModel.create(
        [{ familyId: access.familyId, fileName, sha256, source: [parsed.source.system, parsed.source.version && `GEDCOM ${parsed.source.version}`].filter(Boolean).join(', '), createdBy: actor.userId }],
        { session },
      );
      const batchId = batch!._id;
      const ids = new Map<string, Types.ObjectId>();
      for (const [ref, id] of same) ids.set(`new:${ref}`, new Types.ObjectId(id));
      const now = new Date();
      const docs = plan.create.map((p) => {
        const _id = new Types.ObjectId();
        ids.set(`new:${p.ref}`, _id);
        const { ref: _ref, ...person } = p;
        return {
          _id,
          ...person,
          gender: person.gender ?? undefined,
          familyId: access.familyId,
          privacy: { level: 'family', hideDates: false },
          ...searchFields(person),
          generation: { number: null, status: 'pending', candidates: [], override: null, computedAt: null },
          createdBy: actor.userId,
          importBatchId: batchId,
          createdAt: now,
          updatedAt: now,
        };
      });
      const idFor = (key: string) => (key.startsWith('new:') ? ids.get(key)! : new Types.ObjectId(key));
      // Validates every document before anything is written (Mongoose runs schema validation in insertMany).
      if (docs.length) await FamilyMemberModel.insertMany(docs, { session, ordered: true });

      const edges = [
        ...plan.parentLinks.map((l) => ({ type: 'parent_child', personA: idFor(l.parent), personB: idFor(l.child), subtype: l.subtype })),
        ...plan.partnerships.map((p) => {
          const [a, b] = [idFor(p.a), idFor(p.b)].sort((x, y) => x.toString().localeCompare(y.toString()));
          return { type: 'partnership', personA: a, personB: b, subtype: p.subtype, status: p.status, startDate: p.startDate, endDate: p.endDate };
        }),
      ].map((e) => ({ ...e, familyId: access.familyId, verification: decisions.verifyLinks ? 'verified' : 'unverified', createdBy: actor.userId, importBatchId: batchId, createdAt: now, updatedAt: now }));
      if (edges.length) await RelationshipModel.insertMany(edges, { session, ordered: true });

      // Fill empty details of matched people from the file.
      const filled: { memberId: Types.ObjectId; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];
      if (decisions.fillBlanks) {
        const byRef = new Map(parsed.people.map((p) => [p.ref, p]));
        for (const doc of matchedDocs) {
          const ref = [...same].find(([, id]) => id === (doc.id as string))![0];
          const p = byRef.get(ref)!;
          const before: Record<string, unknown> = {};
          const after: Record<string, unknown> = {};
          for (const field of FILLABLE) {
            const incoming = p[field];
            if (isEmpty(incoming) || !isEmpty(doc.get(field))) continue;
            if ((field === 'deathDate' || field === 'deathPlace') && doc.vitalStatus === 'living') continue;
            before[field] = doc.get(field) ?? null;
            after[field] = incoming;
          }
          if (doc.vitalStatus === 'unknown' && p.vitalStatus !== 'unknown' && !(p.vitalStatus === 'living' && (doc.deathDate || doc.deathPlace))) {
            before['vitalStatus'] = 'unknown';
            after['vitalStatus'] = p.vitalStatus;
          }
          if (!Object.keys(after).length) continue;
          doc.set(after);
          doc.updatedBy = actor.userId;
          await doc.save({ session });
          filled.push({ memberId: doc._id, before, after: Object.fromEntries(Object.keys(after).map((k) => [k, doc.toObject()[k as keyof ReturnType<typeof doc.toObject>] ?? null])) });
        }
      }

      const counts = { created: docs.length, matched: same.size, filled: filled.length, parentLinks: plan.parentLinks.length, partnerships: plan.partnerships.length, skipped: plan.skipped };
      const warningCount = parsed.warnings.length + plan.warnings.length;
      batch!.set({ counts, warningCount, filled });
      await batch!.save({ session });
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'import.commit', targetType: 'import', targetId: batchId, after: { fileName, ...counts, warningCount }, requestId: actor.requestId, ip: actor.ip },
        session,
      );
      await this.families.refreshStats(access.familyId, session);
      return batch!;
    });
    await this.graph.request(access.familyId);
    return this.toView(result);
  }

  async list(access: FamilyAccess): Promise<ImportBatchView[]> {
    access.assert('family.import');
    const batches = await FamilyImportModel.find({ familyId: access.familyId }).sort({ createdAt: -1 }).limit(50);
    return Promise.all(batches.map((b) => this.toView(b)));
  }

  /**
   * Removes everyone an import added and every link it added (people can be brought back one by one
   * from removed people), and puts back details it filled in, unless they have been changed since.
   */
  async undo(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<ImportBatchView> {
    access.assert('family.import');
    const batch = await mongoose.connection.transaction(async (session) => {
      const b = await FamilyImportModel.findOne({ _id: id, familyId: access.familyId }).session(session);
      if (!b) throw AppError.notFound('Import');
      if (b.status !== 'active') throw new AppError('CONFLICT', 'This import has already been undone');
      await FamilyModel.updateOne({ _id: access.familyId }, { $inc: { graphRevision: 1 } }, { session });
      const people = await FamilyMemberModel.find({ familyId: access.familyId, importBatchId: b._id, ...live }, { firstName: 1, surname: 1 }).session(session);
      const peopleIds = people.map((p) => p._id);
      const nameOf = (pid: Types.ObjectId) => {
        const p = people.find((x) => x._id.equals(pid));
        return p ? `${p.firstName} ${p.surname ?? ''}`.trim() : 'someone it added';
      };
      if (access.family.foundingMemberId && peopleIds.some((p) => p.equals(access.family.foundingMemberId!))) {
        throw new AppError('CONFLICT', `${nameOf(access.family.foundingMemberId)} is now the founding ancestor. Choose a different founder before undoing this import.`);
      }
      const claimed = await FamilyMembershipModel.findOne({ familyId: access.familyId, memberProfileId: { $in: peopleIds }, status: 'active' }).session(session);
      if (claimed) throw new AppError('CONFLICT', `A family member has claimed ${nameOf(claimed.memberProfileId!)}'s profile. Unlink their account before undoing this import.`);
      const branch = await FamilyBranchModel.findOne({ familyId: access.familyId, foundingMemberId: { $in: peopleIds }, ...live }).session(session);
      if (branch) throw new AppError('CONFLICT', `The branch "${branch.name}" starts from ${nameOf(branch.foundingMemberId)}. Remove the branch before undoing this import.`);

      const at = new Date();
      await FamilyMemberModel.updateMany({ _id: { $in: peopleIds } }, { $set: { deletedAt: at, deletedBy: actor.userId } }, { session });
      const removedLinks = await RelationshipModel.updateMany(
        { familyId: access.familyId, ...live, $or: [{ importBatchId: b._id }, { personA: { $in: peopleIds } }, { personB: { $in: peopleIds } }] },
        { $set: { deletedAt: at, deletedBy: actor.userId } },
        { session },
      );
      let restored = 0;
      for (const f of b.filled) {
        const doc = await FamilyMemberModel.findOne({ _id: f.memberId, familyId: access.familyId, ...live }).session(session);
        if (!doc) continue;
        const after = (f.after ?? {}) as Record<string, unknown>;
        const unchanged = Object.entries(after).every(([k, v]) => JSON.stringify(doc.toObject()[k as never] ?? null) === JSON.stringify(v ?? null));
        if (!unchanged) continue;
        doc.set(Object.fromEntries(Object.entries((f.before ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v ?? (k.endsWith('Date') ? null : k === 'gender' ? undefined : '')])));
        doc.updatedBy = actor.userId;
        await doc.save({ session });
        restored++;
      }
      b.status = 'undone';
      b.undoneAt = at;
      b.undoneBy = actor.userId;
      await b.save({ session });
      await this.audit.record(
        { familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'import.undo', targetType: 'import', targetId: b._id, after: { fileName: b.fileName, peopleRemoved: peopleIds.length, linksRemoved: removedLinks.modifiedCount, detailsRestored: restored }, requestId: actor.requestId, ip: actor.ip },
        session,
      );
      await this.families.refreshStats(access.familyId, session);
      return b;
    });
    await this.graph.request(access.familyId);
    return this.toView(batch);
  }

  private async toView(b: InstanceType<typeof FamilyImportModel>): Promise<ImportBatchView> {
    const user = await UserModel.findById(b.createdBy, { displayName: 1 }).lean();
    return {
      id: b.id as string,
      fileName: b.fileName,
      source: b.source ?? '',
      status: b.status as ImportBatchView['status'],
      createdAt: (b.get('createdAt') as Date).toISOString(),
      createdBy: user?.displayName ?? null,
      undoneAt: b.undoneAt ? b.undoneAt.toISOString() : null,
      counts: {
        created: b.counts?.created ?? 0,
        matched: b.counts?.matched ?? 0,
        filled: b.counts?.filled ?? 0,
        parentLinks: b.counts?.parentLinks ?? 0,
        partnerships: b.counts?.partnerships ?? 0,
        skipped: b.counts?.skipped ?? 0,
      },
      warningCount: b.warningCount ?? 0,
    };
  }
}
