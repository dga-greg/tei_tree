import { Schema, model, type InferSchemaType } from 'mongoose';
import { FuzzyDateSchema, SourceReferenceSchema, softDeleteFields } from '../../core/schemas.js';

/** A story, oral history, tradition or memory about the family, optionally about specific people. */
const FamilyStorySchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    kind: { type: String, enum: ['story', 'oral_history', 'tradition', 'memory'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 100_000 },
    narrator: { type: String, default: '', maxlength: 200 },
    date: { type: FuzzyDateSchema, default: null },
    place: { type: String, default: '', maxlength: 200 },
    memberIds: { type: [Schema.Types.ObjectId], ref: 'FamilyMember', default: [] },
    eventId: { type: Schema.Types.ObjectId, ref: 'FamilyEvent', default: null },
    mediaIds: { type: [Schema.Types.ObjectId], ref: 'FamilyMedia', default: [] },
    recordingMediaId: { type: Schema.Types.ObjectId, ref: 'FamilyMedia', default: null },
    sources: { type: [SourceReferenceSchema], default: [] },
    privacy: { type: String, enum: ['family', 'admins', 'public'], default: 'family' },
    status: { type: String, enum: ['pending_approval', 'published', 'rejected'], default: 'published' },
    searchText: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'family_stories', optimisticConcurrency: true, versionKey: 'version' },
);

FamilyStorySchema.index({ familyId: 1, deletedAt: 1, createdAt: -1 });
FamilyStorySchema.index({ familyId: 1, memberIds: 1 });
FamilyStorySchema.index({ familyId: 1, 'date.sortKey': 1 });
FamilyStorySchema.index({ familyId: 1, status: 1 });

export type FamilyStory = InferSchemaType<typeof FamilyStorySchema>;
export const FamilyStoryModel = model('FamilyStory', FamilyStorySchema);
export type FamilyStoryDoc = InstanceType<typeof FamilyStoryModel>;
