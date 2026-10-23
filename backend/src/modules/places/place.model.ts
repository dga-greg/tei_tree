import { Schema, model } from 'mongoose';
import { softDeleteFields } from '../../core/schemas.js';

/** A place the family knows. Matched to free-text places on people and events by `keys` (see places.match.ts). */
const FamilyPlaceSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    region: { type: String, default: '', trim: true, maxlength: 120 },
    country: { type: String, default: '', trim: true, maxlength: 120 },
    latitude: { type: Number, default: null, min: -90, max: 90 },
    longitude: { type: Number, default: null, min: -180, max: 180 },
    aliases: { type: [String], default: [] },
    notes: { type: String, default: '', maxlength: 5000 },
    /** Normalised name and aliases. */
    keys: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'family_places', optimisticConcurrency: true, versionKey: 'version' },
);
FamilyPlaceSchema.index({ familyId: 1, deletedAt: 1, name: 1 });
FamilyPlaceSchema.index({ familyId: 1, keys: 1 });
export const FamilyPlaceModel = model('FamilyPlace', FamilyPlaceSchema);
export type FamilyPlaceDoc = InstanceType<typeof FamilyPlaceModel>;
