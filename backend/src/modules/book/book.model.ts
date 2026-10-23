import { Schema, model, type InferSchemaType } from 'mongoose';
import { BOOK_STATUSES } from '@fh/contracts';

/** A family book someone asked for, and the PDF once it is made. Only the person who asked can see it. */
const FamilyBookSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 200 },
    /** BookOptions as asked (contracts/src/book.ts). */
    options: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: BOOK_STATUSES, default: 'queued' },
    progress: { type: Number, default: 0 },
    storageKey: { type: String, default: null },
    sizeBytes: { type: Number, default: null },
    pages: { type: Number, default: null },
    people: { type: Number, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'family_books' },
);
FamilyBookSchema.index({ familyId: 1, requestedBy: 1, createdAt: -1 });

export type FamilyBook = InferSchemaType<typeof FamilyBookSchema>;
export type FamilyBookDoc = ReturnType<(typeof FamilyBookModel)['hydrate']>;
export const FamilyBookModel = model('FamilyBook', FamilyBookSchema);
