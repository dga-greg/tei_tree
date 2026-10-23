import { Types } from 'mongoose';
import { z } from 'zod';
import { displayName, REPORT_REASONS, REPORT_TARGETS, type ReportReason, type ReportStatus, type ReportTarget, type ReportView } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { objectId, pageMeta } from '../../core/validation.js';
import type { MailMessage } from '../../infra/mailer.js';
import type { EmailDispatcher } from '../../infra/queues.js';
import type { AdminService, ActorContext } from '../admin/admin.service.js';
import { archiveVisibility } from '../archive/archive.shared.js';
import type { AuditService } from '../audit/audit.service.js';
import { FamilyEventModel } from '../events/event.model.js';
import { resolveFamilyAccess, type FamilyAccess } from '../families/family-access.js';
import { FamilyModel } from '../families/family.model.js';
import { FamilyMembershipModel } from '../families/membership.model.js';
import { FamilyMediaModel } from '../media/media.model.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { MemberPolicy } from '../members/member.policy.js';
import { FamilyStoryModel } from '../stories/story.model.js';
import { UserModel } from '../users/user.model.js';
import { AbuseReportModel, type AbuseReportDoc } from './report.model.js';


export const createReportBody = z
  .object({
    familyId: objectId,
    targetType: z.enum(REPORT_TARGETS),
    targetId: objectId.optional(),
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().min(10, 'Say briefly what is wrong').max(5000),
  })
  .strict();
export const listReportsQuery = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']).default('open'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const resolveReportBody = z
  .object({
    status: z.enum(['resolved', 'dismissed']),
    resolution: z.string().trim().min(3, 'Explain the decision').max(5000),
    notifyFamilyAdmins: z.boolean().optional(),
    suspendFamily: z.boolean().optional(),
  })
  .strict();

const OPEN_PER_REPORTER = 20;

/**
 * Anyone signed in may report content they can see. Platform administrators review reports without
 * gaining access to family records: they see what was reported (as named at the time) and the reporter's
 * description, and can tell the family's administrators, suspend the family, or dismiss the report.
 */
export class ReportsService {
  constructor(
    private readonly admin: AdminService,
    private readonly email: EmailDispatcher,
    private readonly audit: AuditService,
    private readonly appOrigin: string,
  ) {}

  /** Names the target as the reporter sees it; 404 when it does not exist or is hidden from them. */
  private async label(access: FamilyAccess, type: ReportTarget, id: Types.ObjectId | null): Promise<string> {
    const notFound = () => AppError.notFound('Reported item');
    if (type === 'family') return access.family.name;
    if (!id) throw new AppError('VALIDATION_FAILED', 'Say what you are reporting', [{ path: 'targetId', message: 'Required' }]);
    switch (type) {
      case 'member': {
        const m = await FamilyMemberModel.findOne({ _id: id, familyId: access.familyId, deletedAt: null });
        if (!m || !new MemberPolicy(access).isVisible(m)) throw notFound();
        return `Profile of ${displayName(m)}`;
      }
      case 'media': {
        const m = await FamilyMediaModel.findOne({ ...(await archiveVisibility(access, 'uploadedBy')), _id: id });
        if (!m) throw notFound();
        return `${m.kind === 'photo' ? 'Photo' : 'File'} “${m.title}”`;
      }
      case 'story': {
        const s = await FamilyStoryModel.findOne({ ...(await archiveVisibility(access, 'createdBy')), _id: id });
        if (!s) throw notFound();
        return `Story “${s.title}”`;
      }
      case 'event': {
        const e = await FamilyEventModel.findOne({ ...(await archiveVisibility(access, 'createdBy', false)), _id: id });
        if (!e) throw notFound();
        return `Event “${e.title}”`;
      }
    }
  }

  async create(reporterId: Types.ObjectId, input: z.output<typeof createReportBody>, requestId: string, ip: string | null): Promise<{ id: string }> {
    const access = await resolveFamilyAccess(new Types.ObjectId(input.familyId), reporterId);
    if (!access) throw AppError.notFound('Family');
    const targetId = input.targetType === 'family' ? null : input.targetId ? new Types.ObjectId(input.targetId) : null;
    const targetLabel = await this.label(access, input.targetType, targetId);
    const filter = { reporterId, familyId: access.familyId, targetType: input.targetType, targetId, status: 'open' };
    if (await AbuseReportModel.exists(filter)) throw new AppError('CONFLICT', 'You have already reported this; it is waiting for review.');
    if ((await AbuseReportModel.countDocuments({ reporterId, status: 'open' })) >= OPEN_PER_REPORTER) {
      throw new AppError('RATE_LIMITED', 'You have many reports waiting for review. Please wait for them to be handled.');
    }
    const doc = await AbuseReportModel.create({ ...filter, targetLabel, reason: input.reason, details: input.details });
    await this.audit.record({ familyId: null, actorId: reporterId, actorRole: access.role, action: 'report.create', targetType: 'report', targetId: doc._id, after: { familyId: access.familyId, targetType: input.targetType, reason: input.reason }, requestId, ip });
    return { id: doc.id as string };
  }

  private async views(docs: AbuseReportDoc[]): Promise<ReportView[]> {
    const [families, users] = await Promise.all([
      FamilyModel.find({ _id: { $in: docs.map((d) => d.familyId) } }, { name: 1, status: 1 }).lean(),
      UserModel.find({ _id: { $in: docs.map((d) => d.reporterId) } }, { displayName: 1, email: 1, status: 1 }).lean(),
    ]);
    return docs.map((d) => {
      const f = families.find((x) => x._id.equals(d.familyId));
      const u = users.find((x) => x._id.equals(d.reporterId));
      return {
        id: d.id as string,
        family: f ? { id: f._id.toString(), name: f.name, status: f.status } : null,
        targetType: d.targetType as ReportTarget,
        targetId: d.targetId?.toString() ?? null,
        targetLabel: d.targetLabel,
        reason: d.reason as ReportReason,
        details: d.details,
        reporter: u && u.status !== 'deleted' ? { id: u._id.toString(), displayName: u.displayName, email: u.email } : null,
        status: d.status as ReportStatus,
        resolution: d.resolution,
        actions: d.actions,
        createdAt: d.createdAt.toISOString(),
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
      };
    });
  }

  async list(query: z.output<typeof listReportsQuery>) {
    const filter = { status: query.status };
    const [rows, total] = await Promise.all([
      AbuseReportModel.find(filter).sort({ createdAt: query.status === 'open' ? 1 : -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize),
      AbuseReportModel.countDocuments(filter),
    ]);
    return { data: await this.views(rows), meta: pageMeta(query, total) };
  }

  async resolve(actor: ActorContext, id: Types.ObjectId, input: z.output<typeof resolveReportBody>): Promise<ReportView> {
    const report = await AbuseReportModel.findById(id);
    if (!report) throw AppError.notFound('Report');
    if (report.status !== 'open') throw new AppError('CONFLICT', 'This report has already been handled.');
    const family = await FamilyModel.findById(report.familyId);
    const actions: string[] = [];
    if (input.suspendFamily && family && family.status === 'active') {
      await this.admin.updateFamilyStatus(actor, family._id, 'suspended');
      actions.push('family_suspended');
    }
    if (input.notifyFamilyAdmins && family) {
      const admins = await FamilyMembershipModel.find({ familyId: family._id, role: 'family_admin', status: 'active' }, { userId: 1 }).lean();
      const users = await UserModel.find({ _id: { $in: admins.map((a) => a.userId) }, status: 'active' }, { email: 1, displayName: 1 }).lean();
      for (const u of users) this.email.dispatch(familyNoticeEmail(u.email, u.displayName, family.name, report.targetLabel, input.resolution));
      actions.push('family_admins_notified');
    }
    report.set({ status: input.status, resolution: input.resolution, actions, resolvedBy: actor.userId, resolvedAt: new Date() });
    await report.save();
    const reporter = await UserModel.findOne({ _id: report.reporterId, status: 'active' }, { email: 1, displayName: 1 }).lean();
    if (reporter) this.email.dispatch(reporterEmail(reporter.email, reporter.displayName, report.targetLabel, input.status, input.resolution, new URL('/dashboard', this.appOrigin).toString()));
    await this.audit.record({ familyId: null, actorId: actor.userId, actorRole: 'super_admin', action: `report.${input.status === 'resolved' ? 'resolve' : 'dismiss'}`, targetType: 'report', targetId: report._id, after: { actions, resolution: input.resolution }, requestId: actor.requestId, ip: actor.ip });
    return (await this.views([report]))[0]!;
  }
}

function familyNoticeEmail(to: string, name: string, familyName: string, target: string, note: string): MailMessage {
  return {
    to,
    subject: `A report about content in the ${familyName}`,
    text: [`Hello ${name},`, '', `Someone reported ${target} in the ${familyName}. The platform team reviewed it and asks you, as an administrator of the family, to look at it:`, '', note, '', 'You can edit or remove the item from the family pages.'].join('\n'),
  };
}

function reporterEmail(to: string, name: string, target: string, status: 'resolved' | 'dismissed', note: string, url: string): MailMessage {
  return {
    to,
    subject: 'Your report has been reviewed',
    text: [`Hello ${name},`, '', `Thank you for reporting ${target}. ${status === 'resolved' ? 'We have acted on it.' : 'We looked at it and decided not to take action.'}`, '', note, '', url].join('\n'),
  };
}
