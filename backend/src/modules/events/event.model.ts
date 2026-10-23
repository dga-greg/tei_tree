import { Schema, model, type InferSchemaType } from 'mongoose';
import { EVENT_KINDS } from '@fh/contracts';
import { FuzzyDateSchema, SourceReferenceSchema, softDeleteFields } from '../../core/schemas.js';

const FamilyEventSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    kind: {
      type: String,
      enum: EVENT_KINDS,
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 20_000 },
    date: { type: FuzzyDateSchema, default: null },
    place: { type: String, default: '', maxlength: 200 },
    memberIds: { type: [Schema.Types.ObjectId], ref: 'FamilyMember', default: [] },
    mediaIds: { type: [Schema.Types.ObjectId], ref: 'FamilyMedia', default: [] },
    sources: { type: [SourceReferenceSchema], default: [] },
    privacy: { type: String, enum: ['family', 'admins', 'public'], default: 'family' },
    /** Ceremonies: the order of events and who does what. */
    programme: {
      type: [new Schema({ time: { type: String, default: '', maxlength: 40 }, title: { type: String, required: true, maxlength: 200 }, detail: { type: String, default: '', maxlength: 1000 }, lead: { type: String, default: '', maxlength: 120 } }, { _id: false })],
      default: [],
    },
    roles: {
      type: [new Schema({ role: { type: String, required: true, maxlength: 80 }, memberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', default: null }, name: { type: String, default: '', maxlength: 120 } }, { _id: false })],
      default: [],
    },
    fundId: { type: Schema.Types.ObjectId, ref: 'FamilyFund', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'family_events', optimisticConcurrency: true, versionKey: 'version' },
);

FamilyEventSchema.index({ familyId: 1, 'date.sortKey': 1 });
FamilyEventSchema.index({ familyId: 1, memberIds: 1 });
FamilyEventSchema.index({ familyId: 1, kind: 1, 'date.sortKey': -1 });

export type FamilyEvent = InferSchemaType<typeof FamilyEventSchema>;
export const FamilyEventModel = model('FamilyEvent', FamilyEventSchema);
export type FamilyEventDoc = InstanceType<typeof FamilyEventModel>;
