import { Schema, model, type InferSchemaType } from 'mongoose';

/** Append-only record of changes and administrative actions. Never updated or deleted by the app. */
const AuditLogSchema = new Schema(
  {
    /** Null for platform-level actions. */
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, maxlength: 100 },
    targetType: { type: String, required: true, maxlength: 50 },
    targetId: { type: Schema.Types.ObjectId, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    contributionId: { type: Schema.Types.ObjectId, ref: 'FamilyContribution', default: null },
    requestId: { type: String, default: null },
    ip: { type: String, default: null },
    at: { type: Date, default: () => new Date(), required: true },
  },
  { collection: 'audit_logs' },
);

AuditLogSchema.index({ familyId: 1, at: -1 });
AuditLogSchema.index({ familyId: 1, targetType: 1, targetId: 1, at: -1 });
AuditLogSchema.index({ actorId: 1, at: -1 });

export type AuditLog = InferSchemaType<typeof AuditLogSchema>;
export const AuditLogModel = model('AuditLog', AuditLogSchema);
