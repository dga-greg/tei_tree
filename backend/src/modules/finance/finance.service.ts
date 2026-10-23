import { Types } from 'mongoose';
import { z } from 'zod';
import {
  DUES_PERIODS,
  FUND_KINDS,
  FUND_VISIBILITIES,
  MAX_AMOUNT,
  PAYMENT_METHODS,
  currencyDigits,
  type FundContributionView,
  type FundReport,
  type FundView,
  type PersonCard,
} from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { objectId } from '../../core/validation.js';
import { assertPeople, peopleCards, userNames } from '../archive/archive.shared.js';
import type { AuditService } from '../audit/audit.service.js';
import type { BranchesService } from '../branches/branches.service.js';
import { FamilyBranchModel } from '../branches/branch.model.js';
import { FamilyEventModel } from '../events/event.model.js';
import type { FamilyAccess } from '../families/family-access.js';
import type { Actor } from '../relationships/relationships.service.js';
import { FamilyFundModel, FundContributionModel, type FamilyFundDoc, type FundContributionDoc } from './fund.model.js';

const live = { deletedAt: null };
/** ISO 4217 codes the runtime knows (Intl accepts any three letters when formatting, so check the list). */
const KNOWN_CURRENCIES = new Set((Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('currency') ?? ['GHS', 'NGN', 'XOF', 'KES', 'ZAR', 'GBP', 'USD', 'EUR', 'CAD']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const amount = z.number().int('Amounts are whole numbers of the smallest unit (e.g. pesewas)').min(1).max(MAX_AMOUNT);

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, e.g. GHS')
  .refine((c) => KNOWN_CURRENCIES.has(c), 'Unknown currency');

const fundFields = {
  name: z.string().trim().min(2, 'Name the fund').max(120),
  purpose: z.string().trim().max(5000),
  kind: z.enum(FUND_KINDS),
  currency,
  target: amount.nullable(),
  dues: z.object({ amount, period: z.enum(DUES_PERIODS) }).strict().nullable(),
  payerIds: z.array(objectId).max(5000),
  visibility: z.enum(FUND_VISIBILITIES),
  status: z.enum(['open', 'closed']),
  ceremonyId: objectId.nullable(),
};
export const createFundBody = z.object(fundFields).partial().required({ name: true, kind: true }).strict();
export const updateFundBody = z.object(fundFields).partial().extend({ version: z.number().int().min(0) }).strict();

const contributionFields = {
  memberId: objectId.nullable(),
  contributorName: z.string().trim().max(120),
  amount,
  date: z.string().regex(DAY, 'Use YYYY-MM-DD').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Not a real date'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120),
  note: z.string().trim().max(1000),
};
export const contributionBody = z
  .object(contributionFields)
  .partial()
  .required({ amount: true, date: true, method: true })
  .strict()
  .refine((c) => !!c.memberId || !!c.contributorName, { message: 'Choose a person or enter the contributor’s name', path: ['contributorName'] });
export const updateContributionBody = z.object(contributionFields).partial().strict();
export const reportQuery = z.object({ period: z.string().regex(/^\d{4}(-\d{2})?$/).optional() }).strict();

/** A spreadsheet cell: quoted, and never starting a formula. */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Family funds and the money given to them. Administrators and treasurers manage funds; members see
 * funds and totals as each fund allows, and always their own contributions. Every change is audited.
 */
export class FinanceService {
  constructor(
    private readonly audit: AuditService,
    private readonly branches: BranchesService,
  ) {}

  private manages(access: FamilyAccess): boolean {
    return access.can('finance.manage');
  }

  private seesContributions(access: FamilyAccess, fund: FamilyFundDoc): boolean {
    return this.manages(access) || fund.visibility === 'members';
  }

  private async load(access: FamilyAccess, id: Types.ObjectId): Promise<FamilyFundDoc> {
    access.assert('finance.view');
    const fund = await FamilyFundModel.findOne({ _id: id, familyId: access.familyId, ...live });
    // Funds kept to administrators are invisible to others (404, not 403).
    if (!fund || (fund.visibility === 'admins' && !this.manages(access))) throw AppError.notFound('Fund');
    return fund;
  }

  private async toViews(access: FamilyAccess, funds: FamilyFundDoc[]): Promise<FundView[]> {
    const ids = funds.map((f) => f._id);
    const totals = ids.length
      ? await FundContributionModel.aggregate<{ _id: Types.ObjectId; amount: number; count: number; contributors: string[] }>([
          { $match: { familyId: access.familyId, fundId: { $in: ids }, deletedAt: null } },
          {
            $group: {
              _id: '$fundId',
              amount: { $sum: '$amount' },
              count: { $sum: 1 },
              contributors: { $addToSet: { $ifNull: [{ $toString: '$memberId' }, { $toLower: '$contributorName' }] } },
            },
          },
        ])
      : [];
    const people = await peopleCards(access, funds.flatMap((f) => f.payerIds));
    const events = await FamilyEventModel.find({ _id: { $in: funds.map((f) => f.ceremonyId).filter(Boolean) }, familyId: access.familyId, deletedAt: null }, { title: 1 }).lean();
    const manage = this.manages(access);
    return funds.map((f) => {
      const t = totals.find((x) => x._id.equals(f._id));
      const event = events.find((e) => f.ceremonyId && e._id.equals(f.ceremonyId));
      return {
        id: f.id as string,
        name: f.name,
        purpose: f.purpose,
        kind: f.kind as FundView['kind'],
        currency: f.currency,
        target: f.target ?? null,
        dues: f.dues ? { amount: f.dues.amount, period: f.dues.period as 'monthly' | 'yearly' | 'once' } : null,
        payers: manage || f.visibility === 'members' ? f.payerIds.map((id) => people.get(id.toString())).filter((p): p is PersonCard => !!p) : [],
        status: f.status as FundView['status'],
        visibility: f.visibility as FundView['visibility'],
        ceremony: event ? { id: event._id.toString(), title: event.title } : null,
        totals: { amount: t?.amount ?? 0, count: t?.count ?? 0, contributors: t?.contributors.length ?? 0 },
        createdAt: f.createdAt.toISOString(),
        viewerCan: { manage, seeContributions: this.seesContributions(access, f) },
        version: f.get('version') as number,
      };
    });
  }

  async list(access: FamilyAccess): Promise<FundView[]> {
    access.assert('finance.view');
    const funds = await FamilyFundModel.find({ familyId: access.familyId, ...live, ...(this.manages(access) ? {} : { visibility: { $ne: 'admins' } }) }).sort({ status: -1, createdAt: -1 });
    return this.toViews(access, funds);
  }

  async get(access: FamilyAccess, id: Types.ObjectId): Promise<FundView> {
    return (await this.toViews(access, [await this.load(access, id)]))[0]!;
  }

  private async apply(access: FamilyAccess, fund: FamilyFundDoc, patch: Partial<z.output<typeof createFundBody>>): Promise<Types.ObjectId | null | undefined> {
    if (patch.currency !== undefined && !fund.isNew && patch.currency !== fund.currency) {
      // Changing the currency would change the meaning of every amount already recorded.
      if (await FundContributionModel.exists({ fundId: fund._id, ...live })) throw new AppError('CONFLICT', 'The currency cannot change once contributions are recorded');
    }
    for (const key of ['name', 'purpose', 'kind', 'currency', 'target', 'visibility', 'status'] as const) if (patch[key] !== undefined) fund.set(key, patch[key]);
    if (patch.dues !== undefined) fund.set('dues', patch.dues);
    if (patch.payerIds !== undefined) fund.payerIds = await assertPeople(access, patch.payerIds);
    if (patch.ceremonyId !== undefined) {
      if (patch.ceremonyId && !(await FamilyEventModel.exists({ _id: patch.ceremonyId, familyId: access.familyId, ...live }))) {
        throw new AppError('VALIDATION_FAILED', 'That ceremony is not in this family', [{ path: 'ceremonyId', message: 'Unknown event' }]);
      }
      fund.ceremonyId = patch.ceremonyId ? new Types.ObjectId(patch.ceremonyId) : null;
      return fund.ceremonyId;
    }
    return undefined;
  }

  /** Keeps the ceremony's link to its fund in step (a ceremony shows one fund). */
  private async linkCeremony(fund: FamilyFundDoc, ceremonyId: Types.ObjectId | null | undefined): Promise<void> {
    if (ceremonyId === undefined) return;
    await FamilyEventModel.updateMany({ familyId: fund.familyId, fundId: fund._id, ...(ceremonyId ? { _id: { $ne: ceremonyId } } : {}) }, { $set: { fundId: null } });
    if (ceremonyId) await FamilyEventModel.updateOne({ _id: ceremonyId, familyId: fund.familyId }, { $set: { fundId: fund._id } });
  }

  async create(access: FamilyAccess, actor: Actor, input: z.output<typeof createFundBody>): Promise<FundView> {
    access.assert('finance.manage');
    const fund = new FamilyFundModel({ familyId: access.familyId, createdBy: actor.userId, name: input.name, kind: input.kind });
    const ceremony = await this.apply(access, fund, input);
    if (fund.kind === 'dues' && !fund.dues) throw new AppError('VALIDATION_FAILED', 'Dues need an amount and how often they are paid', [{ path: 'dues', message: 'Required for dues' }]);
    await fund.save();
    await this.linkCeremony(fund, ceremony);
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'fund.create', targetType: 'fund', targetId: fund._id, after: fund.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.get(access, fund._id);
  }

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: z.output<typeof updateFundBody>): Promise<FundView> {
    access.assert('finance.manage');
    const fund = await this.load(access, id);
    if ((fund.get('version') as number) !== patch.version) throw new AppError('VERSION_CONFLICT', 'This fund was changed by someone else. Reload and try again.');
    const before = fund.toObject();
    const { version: _v, ...fields } = patch;
    const ceremony = await this.apply(access, fund, fields);
    if (fund.kind === 'dues' && !fund.dues) throw new AppError('VALIDATION_FAILED', 'Dues need an amount and how often they are paid', [{ path: 'dues', message: 'Required for dues' }]);
    await fund.save();
    await this.linkCeremony(fund, ceremony);
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'fund.update', targetType: 'fund', targetId: fund._id, before, after: fund.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.get(access, fund._id);
  }

  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    access.assert('finance.manage');
    const fund = await this.load(access, id);
    fund.deletedAt = new Date();
    fund.deletedBy = actor.userId;
    await fund.save();
    await FamilyEventModel.updateMany({ familyId: access.familyId, fundId: fund._id }, { $set: { fundId: null } });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'fund.delete', targetType: 'fund', targetId: fund._id, before: { name: fund.name }, requestId: actor.requestId, ip: actor.ip });
  }

  // ------------------------------------------------------------------ contributions

  private async contributionViews(access: FamilyAccess, rows: FundContributionDoc[]): Promise<FundContributionView[]> {
    const people = await peopleCards(access, rows.map((r) => r.memberId).filter((id): id is Types.ObjectId => !!id));
    const names = this.manages(access) ? await userNames(rows.map((r) => r.recordedBy)) : new Map<string, string>();
    return rows.map((r) => ({
      id: r.id as string,
      fundId: r.fundId.toString(),
      person: r.memberId ? (people.get(r.memberId.toString()) ?? null) : null,
      contributorName: r.contributorName || (r.memberId ? (people.get(r.memberId.toString())?.displayName ?? '') : ''),
      amount: r.amount,
      date: r.date,
      method: r.method as FundContributionView['method'],
      reference: this.manages(access) ? r.reference : '',
      note: r.note,
      recordedBy: names.get(r.recordedBy.toString()) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Everyone's contributions where the viewer may see them; otherwise only the viewer's own. */
  async contributions(access: FamilyAccess, fundId: Types.ObjectId): Promise<FundContributionView[]> {
    const fund = await this.load(access, fundId);
    const filter: Record<string, unknown> = { familyId: access.familyId, fundId: fund._id, ...live };
    if (!this.seesContributions(access, fund)) {
      if (!access.ownProfileId) return [];
      filter['memberId'] = access.ownProfileId;
    }
    const rows = await FundContributionModel.find(filter).sort({ date: -1, createdAt: -1 }).limit(5000);
    return this.contributionViews(access, rows);
  }

  /** The viewer's own contributions in every fund (through their claimed profile). */
  async mine(access: FamilyAccess): Promise<(FundContributionView & { fund: { id: string; name: string; currency: string } })[]> {
    access.assert('finance.view');
    if (!access.ownProfileId) return [];
    const rows = await FundContributionModel.find({ familyId: access.familyId, memberId: access.ownProfileId, ...live }).sort({ date: -1 }).limit(1000);
    const funds = await FamilyFundModel.find({ _id: { $in: rows.map((r) => r.fundId) }, ...live }, { name: 1, currency: 1 }).lean();
    const views = await this.contributionViews(access, rows);
    return views.flatMap((v) => {
      const f = funds.find((x) => x._id.toString() === v.fundId);
      return f ? [{ ...v, fund: { id: v.fundId, name: f.name, currency: f.currency } }] : [];
    });
  }

  private async checkContributor(access: FamilyAccess, memberId: string | null | undefined): Promise<Types.ObjectId | null> {
    if (!memberId) return null;
    return (await assertPeople(access, [memberId]))[0]!;
  }

  async addContribution(access: FamilyAccess, actor: Actor, fundId: Types.ObjectId, input: z.output<typeof contributionBody>): Promise<FundContributionView> {
    access.assert('finance.manage');
    const fund = await this.load(access, fundId);
    if (fund.status === 'closed') throw new AppError('CONFLICT', 'This fund is closed. Reopen it to record contributions.');
    const row = await FundContributionModel.create({
      familyId: access.familyId,
      fundId: fund._id,
      memberId: await this.checkContributor(access, input.memberId),
      contributorName: input.contributorName ?? '',
      amount: input.amount,
      date: input.date,
      method: input.method,
      reference: input.reference ?? '',
      note: input.note ?? '',
      recordedBy: actor.userId,
    });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'fund.contribution.add', targetType: 'fund', targetId: fund._id, after: row.toObject(), requestId: actor.requestId, ip: actor.ip });
    return (await this.contributionViews(access, [row]))[0]!;
  }

  private async loadContribution(access: FamilyAccess, fundId: Types.ObjectId, id: Types.ObjectId): Promise<FundContributionDoc> {
    await this.load(access, fundId);
    const row = await FundContributionModel.findOne({ _id: id, familyId: access.familyId, fundId, ...live });
    if (!row) throw AppError.notFound('Contribution');
    return row;
  }

  async updateContribution(access: FamilyAccess, actor: Actor, fundId: Types.ObjectId, id: Types.ObjectId, patch: z.output<typeof updateContributionBody>): Promise<FundContributionView> {
    access.assert('finance.manage');
    const row = await this.loadContribution(access, fundId, id);
    const before = row.toObject();
    if (patch.memberId !== undefined) row.memberId = await this.checkContributor(access, patch.memberId);
    for (const key of ['contributorName', 'amount', 'date', 'method', 'reference', 'note'] as const) if (patch[key] !== undefined) row.set(key, patch[key]);
    if (!row.memberId && !row.contributorName) throw new AppError('VALIDATION_FAILED', 'Choose a person or enter the contributor’s name', [{ path: 'contributorName', message: 'Required' }]);
    await row.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'fund.contribution.update', targetType: 'fund', targetId: fundId, before, after: row.toObject(), requestId: actor.requestId, ip: actor.ip });
    return (await this.contributionViews(access, [row]))[0]!;
  }

  async removeContribution(access: FamilyAccess, actor: Actor, fundId: Types.ObjectId, id: Types.ObjectId): Promise<void> {
    access.assert('finance.manage');
    const row = await this.loadContribution(access, fundId, id);
    row.deletedAt = new Date();
    row.deletedBy = actor.userId;
    await row.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'fund.contribution.delete', targetType: 'fund', targetId: fundId, before: row.toObject(), requestId: actor.requestId, ip: actor.ip });
  }

  // ------------------------------------------------------------------ reports

  /** The dues period containing a day: "2026-10" for monthly dues, "2026" for yearly, "all" for once. */
  static periodOf(period: 'monthly' | 'yearly' | 'once', day: string): string {
    return period === 'monthly' ? day.slice(0, 7) : period === 'yearly' ? day.slice(0, 4) : 'all';
  }

  async report(access: FamilyAccess, fundId: Types.ObjectId, query: z.output<typeof reportQuery>): Promise<FundReport> {
    const fund = await this.load(access, fundId);
    if (!this.seesContributions(access, fund)) throw AppError.forbidden('Only the fund’s totals are shared with members');
    const rows = await FundContributionModel.find({ familyId: access.familyId, fundId: fund._id, ...live }, { memberId: 1, amount: 1, date: 1 }).lean();

    const byMonth = new Map<string, number>();
    for (const r of rows) byMonth.set(r.date.slice(0, 7), (byMonth.get(r.date.slice(0, 7)) ?? 0) + r.amount);

    const branches = await FamilyBranchModel.find({ familyId: access.familyId, ...live }, { name: 1 }).sort({ name: 1 });
    const inAnyBranch = new Set<string>();
    const byBranch: FundReport['byBranch'] = [];
    for (const b of branches) {
      const members = new Set((await this.branches.memberIds(access, b._id)).map(String));
      const mine = rows.filter((r) => r.memberId && members.has(r.memberId.toString()));
      mine.forEach((r) => inAnyBranch.add(r._id.toString()));
      byBranch.push({ branch: { id: b.id as string, name: b.name }, amount: mine.reduce((n, r) => n + r.amount, 0), count: mine.length });
    }
    const rest = rows.filter((r) => !inAnyBranch.has(r._id.toString()));
    if (rest.length) byBranch.push({ branch: null, amount: rest.reduce((n, r) => n + r.amount, 0), count: rest.length });

    let dues: FundReport['dues'] = null;
    if (fund.dues) {
      const today = new Date().toISOString().slice(0, 10);
      const period = fund.dues.period === 'once' ? 'all' : (query.period ?? FinanceService.periodOf(fund.dues.period as 'monthly' | 'yearly', today));
      const inPeriod = rows.filter((r) => period === 'all' || r.date.startsWith(period));
      const people = await peopleCards(access, fund.payerIds);
      const due = fund.dues.amount;
      const duesRows = fund.payerIds.flatMap((id) => {
        const person = people.get(id.toString());
        if (!person) return [];
        const paid = inPeriod.filter((r) => r.memberId?.equals(id)).reduce((n, r) => n + r.amount, 0);
        return [{ person, due, paid, balance: Math.max(0, due - paid) }];
      });
      dues = { period, rows: duesRows.sort((a, b) => b.balance - a.balance || a.person.displayName.localeCompare(b.person.displayName)), totals: { due: due * duesRows.length, paid: duesRows.reduce((n, r) => n + Math.min(r.paid, r.due), 0) } };
    }
    return { byBranch, byMonth: [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, amount })), dues };
  }

  async csv(access: FamilyAccess, actor: Actor, fundId: Types.ObjectId): Promise<{ filename: string; body: string }> {
    const fund = await this.load(access, fundId);
    if (!this.seesContributions(access, fund)) throw AppError.forbidden('Only the fund’s totals are shared with members');
    const rows = await this.contributions(access, fundId);
    const digits = currencyDigits(fund.currency);
    const lines = [
      ['Date', 'Contributor', 'In the family tree', `Amount (${fund.currency})`, 'Method', 'Reference', 'Note', 'Recorded by'].map(csvCell).join(','),
      ...rows.map((r) => [r.date, r.contributorName, r.person ? 'yes' : 'no', (r.amount / 10 ** digits).toFixed(digits), r.method, r.reference, r.note, r.recordedBy ?? ''].map(csvCell).join(',')),
    ];
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'fund.export', targetType: 'fund', targetId: fund._id, after: { rows: rows.length }, requestId: actor.requestId, ip: actor.ip });
    const slug = fund.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fund';
    // Byte-order mark so spreadsheet programs read the names' accents correctly.
    return { filename: `${slug}-${new Date().toISOString().slice(0, 10)}.csv`, body: `﻿${lines.join('\r\n')}\r\n` };
  }
}
