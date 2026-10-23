import { Schema } from 'mongoose';
import { DATE_QUALIFIERS } from '@fh/contracts';

/** Embedded FuzzyDate (see contracts/src/dates.ts). `sortKey` is maintained by the owning service. */
export const FuzzyDateSchema = new Schema(
  {
    year: { type: Number, min: 1, max: 3000 },
    month: { type: Number, min: 1, max: 12 },
    day: { type: Number, min: 1, max: 31 },
    qualifier: { type: String, enum: DATE_QUALIFIERS, default: 'exact' },
    endYear: { type: Number, min: 1, max: 3000 },
    text: { type: String, maxlength: 200, trim: true },
    sortKey: { type: Number, default: null },
  },
  { _id: false },
);

export const SourceReferenceSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 300, trim: true },
    citation: { type: String, maxlength: 2000, trim: true },
    url: { type: String, maxlength: 2000, trim: true },
    mediaId: { type: Schema.Types.ObjectId, ref: 'FamilyMedia' },
  },
  { _id: false },
);

/** Soft-deletion fields shared by genealogy collections. */
export const softDeleteFields = {
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
} as const;
