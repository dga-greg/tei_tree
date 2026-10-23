import { Schema, model } from 'mongoose';
import { REPORT_REASONS, REPORT_TARGETS } from '@fh/contracts';

/** A report of content that breaks the rules, reviewed by platform administrators. */
const AbuseReportSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    targetType: { type: String, enum: REPORT_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    targetLabel: { type: String, required: true, maxlength: 300 },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: '', maxlength: 5000 },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
    resolution: { type: String, default: '', maxlength: 5000 },
    actions: { type: [String], default: [] },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'abuse_reports' },
);
AbuseReportSchema.index({ status: 1, createdAt: -1 });
AbuseReportSchema.index({ reporterId: 1, targetType: 1, targetId: 1, status: 1 });
/** Kept when a family is purged, as the platform's record of what was reported. */
export const AbuseReportModel = model('AbuseReport', AbuseReportSchema);
export type AbuseReportDoc = InstanceType<typeof AbuseReportModel>;
