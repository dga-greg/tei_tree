import { Schema, model, type InferSchemaType } from 'mongoose';
import { FuzzyDateSchema, softDeleteFields } from '../../core/schemas.js';

/** Metadata for a file held in object storage. Files are only served through signed, short-lived URLs. */
const FamilyMediaSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    kind: { type: String, enum: ['photo', 'document', 'audio', 'video'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    storageKey: { type: String, required: true },
    /** Small WebP preview (photos only). */
    thumbKey: { type: String, default: null },
    /** Name of the file as uploaded, offered again on download. */
    originalName: { type: String, default: '', maxlength: 255 },
    mimeType: { type: String, required: true },
    byteSize: { type: Number, required: true, min: 0 },
    sha256: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    durationSec: { type: Number },
    memberIds: { type: [Schema.Types.ObjectId], ref: 'FamilyMember', default: [] },
    eventId: { type: Schema.Types.ObjectId, ref: 'FamilyEvent', default: null },
    date: { type: FuzzyDateSchema, default: null },
    privacy: { type: String, enum: ['family', 'admins', 'public'], default: 'family' },
    provenance: {
      source: { type: String, default: '', maxlength: 500 },
      citation: { type: String, default: '', maxlength: 2000 },
      originalHolder: { type: String, default: '', maxlength: 200 },
    },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['processing', 'pending_approval', 'published', 'rejected'], default: 'processing' },
    /** People tagged in a photo, with where they are (fractions of the width and height). */
    tags: {
      type: [
        new Schema(
          {
            memberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
            box: { x: { type: Number, min: 0, max: 1 }, y: { type: Number, min: 0, max: 1 }, w: { type: Number, min: 0, max: 1 }, h: { type: Number, min: 0, max: 1 } },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** Recordings and videos: what is said, typed or transcribed automatically. */
    transcript: {
      status: { type: String, enum: ['none', 'pending', 'done', 'failed'], default: 'none' },
      text: { type: String, default: '', maxlength: 200_000 },
      language: { type: String, default: '', maxlength: 60 },
      source: { type: String, enum: ['typed', 'automatic', null], default: null },
      translation: {
        type: new Schema({ text: { type: String, default: '', maxlength: 200_000 }, language: { type: String, default: '', maxlength: 60 } }, { _id: false }),
        default: null,
      },
      error: { type: String, default: null, maxlength: 500 },
      updatedAt: { type: Date, default: null },
    },
    /** Lower-cased title and description words for search. */
    searchText: { type: String, default: '' },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'family_media', optimisticConcurrency: true, versionKey: 'version' },
);

FamilyMediaSchema.index({ familyId: 1, memberIds: 1 });
FamilyMediaSchema.index({ familyId: 1, 'tags.memberId': 1 });
FamilyMediaSchema.index({ familyId: 1, kind: 1, createdAt: -1 });
FamilyMediaSchema.index({ familyId: 1, status: 1 });
FamilyMediaSchema.index({ storageKey: 1 }, { unique: true });
FamilyMediaSchema.index({ familyId: 1, sha256: 1 });
FamilyMediaSchema.index({ familyId: 1, eventId: 1 });

export type FamilyMedia = InferSchemaType<typeof FamilyMediaSchema>;
export const FamilyMediaModel = model('FamilyMedia', FamilyMediaSchema);
export type FamilyMediaDoc = InstanceType<typeof FamilyMediaModel>;
