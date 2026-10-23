import { Schema, model } from 'mongoose';
import { DUES_PERIODS, FUND_KINDS, FUND_VISIBILITIES, PAYMENT_METHODS } from '@fh/contracts';
import { softDeleteFields } from '../../core/schemas.js';

/** A family fund: dues, a ceremony's collection, a project or welfare. Amounts are integers in minor units. */
const FamilyFundSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    purpose: { type: String, default: '', maxlength: 5000 },
    kind: { type: String, enum: FUND_KINDS, required: true },
    currency: { type: String, default: 'GHS', uppercase: true, minlength: 3, maxlength: 3 },
    target: { type: Number, default: null, min: 0 },
    dues: {
      type: new Schema({ amount: { type: Number, required: true, min: 1 }, period: { type: String, enum: DUES_PERIODS, required: true } }, { _id: false }),
      default: null,
    },
    payerIds: { type: [Schema.Types.ObjectId], ref: 'FamilyMember', default: [] },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    visibility: { type: String, enum: FUND_VISIBILITIES, default: 'totals' },
    ceremonyId: { type: Schema.Types.ObjectId, ref: 'FamilyEvent', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'family_funds', optimisticConcurrency: true, versionKey: 'version' },
);
FamilyFundSchema.index({ familyId: 1, deletedAt: 1, createdAt: -1 });
export const FamilyFundModel = model('FamilyFund', FamilyFundSchema);
export type FamilyFundDoc = InstanceType<typeof FamilyFundModel>;

/** Money received for a fund, from someone in the tree or a named contributor. */
const FundContributionSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    fundId: { type: Schema.Types.ObjectId, ref: 'FamilyFund', required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', default: null },
    contributorName: { type: String, default: '', trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: 1 },
    /** Calendar day, YYYY-MM-DD. */
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    method: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    reference: { type: String, default: '', trim: true, maxlength: 120 },
    note: { type: String, default: '', maxlength: 1000 },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'fund_contributions' },
);
FundContributionSchema.index({ familyId: 1, fundId: 1, deletedAt: 1, date: -1 });
FundContributionSchema.index({ familyId: 1, memberId: 1 });
export const FundContributionModel = model('FundContribution', FundContributionSchema);
export type FundContributionDoc = InstanceType<typeof FundContributionModel>;
