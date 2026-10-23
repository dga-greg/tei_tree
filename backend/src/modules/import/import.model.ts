import { Schema, model, type InferSchemaType } from 'mongoose';
import { IMPORT_STATUSES } from '@fh/contracts';

/**
 * One GEDCOM import into a family. People and links it added carry its id, so the whole import can
 * be undone; details it filled in on people already in the family are kept here to put back.
 */
const FamilyImportSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    fileName: { type: String, required: true, maxlength: 255 },
    sha256: { type: String, required: true },
    source: { type: String, default: '', maxlength: 200 },
    status: { type: String, enum: IMPORT_STATUSES, default: 'active' },
    counts: {
      created: { type: Number, default: 0 },
      matched: { type: Number, default: 0 },
      filled: { type: Number, default: 0 },
      parentLinks: { type: Number, default: 0 },
      partnerships: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    warningCount: { type: Number, default: 0 },
    /** Details filled in on existing people: the values before and after, per person. */
    filled: {
      type: [new Schema({ memberId: { type: Schema.Types.ObjectId, required: true }, before: Schema.Types.Mixed, after: Schema.Types.Mixed }, { _id: false })],
      default: [],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    undoneAt: { type: Date, default: null },
    undoneBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'family_imports' },
);

FamilyImportSchema.index({ familyId: 1, createdAt: -1 });

export type FamilyImport = InferSchemaType<typeof FamilyImportSchema>;
export const FamilyImportModel = model('FamilyImport', FamilyImportSchema);
