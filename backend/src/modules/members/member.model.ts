import { Schema, model, type InferSchemaType } from 'mongoose';
import { GENDERS, GENERATION_STATUSES, MEMBER_PRIVACY_LEVELS, VITAL_STATUSES } from '@fh/contracts';
import { FuzzyDateSchema, SourceReferenceSchema, softDeleteFields } from '../../core/schemas.js';

const TimelineEntrySchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    organisation: { type: String, trim: true, maxlength: 200 },
    from: { type: FuzzyDateSchema, default: null },
    to: { type: FuzzyDateSchema, default: null },
    description: { type: String, maxlength: 2000 },
  },
  { _id: true },
);

/**
 * A person in one family's tree. Generation fields are a cache owned by the generation engine
 * (Phase 3) and must never be written from user input.
 */
const FamilyMemberSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },

    firstName: { type: String, required: true, trim: true, maxlength: 100 },
    middleNames: { type: String, default: '', trim: true, maxlength: 200 },
    surname: { type: String, default: '', trim: true, maxlength: 100 },
    maidenName: { type: String, default: '', trim: true, maxlength: 100 },
    previousNames: { type: [String], default: [] },
    preferredName: { type: String, default: '', trim: true, maxlength: 100 },
    title: { type: String, default: '', trim: true, maxlength: 60 },
    gender: { type: String, enum: GENDERS, default: undefined },

    vitalStatus: { type: String, enum: VITAL_STATUSES, default: 'unknown' },
    birthDate: { type: FuzzyDateSchema, default: null },
    birthPlace: { type: String, default: '', maxlength: 200 },
    deathDate: { type: FuzzyDateSchema, default: null },
    deathPlace: { type: String, default: '', maxlength: 200 },
    nationality: { type: String, default: '', maxlength: 100 },
    hometown: { type: String, default: '', maxlength: 120 },
    /** Where the person lives now ("place of stay"). */
    residence: { type: String, default: '', trim: true, maxlength: 200 },
    /** Extra details the family records, e.g. Occupation: Teacher. */
    attributes: {
      type: [new Schema({ name: { type: String, required: true, trim: true, maxlength: 60 }, value: { type: String, default: '', trim: true, maxlength: 500 } }, { _id: false })],
      default: [],
    },
    /**
     * Family ID (G1, G1.2, G1.2-W1…): given once when the person is connected to the family and never changed or
     * reused, so it can be written down and shared. See members/family-code.ts.
     */
    familyCode: { type: String, default: null },
    /** Lines recorded on this person (see contracts/src/lineage.ts); empty means inherited from the parents. */
    maternalLine: { type: String, default: '', trim: true, maxlength: 80 },
    paternalLine: { type: String, default: '', trim: true, maxlength: 80 },
    totem: { type: String, default: '', trim: true, maxlength: 80 },

    biography: { type: String, default: '', maxlength: 50_000 },
    education: { type: [TimelineEntrySchema], default: [] },
    occupations: { type: [TimelineEntrySchema], default: [] },
    achievements: { type: [String], default: [] },
    sources: { type: [SourceReferenceSchema], default: [] },

    profilePhotoMediaId: { type: Schema.Types.ObjectId, ref: 'FamilyMedia', default: null },
    /** The person asked not to get SMS or WhatsApp messages from the family (through their personal link). */
    messagingOptOutAt: { type: Date, default: null },

    /** Private contact details: never returned unless explicitly selected for an authorised viewer. */
    contact: {
      type: new Schema(
        {
          email: { type: String, maxlength: 254 },
          phone: { type: String, maxlength: 40 },
          address: { type: String, maxlength: 500 },
        },
        { _id: false },
      ),
      select: false,
      default: undefined,
    },

    privacy: {
      level: { type: String, enum: MEMBER_PRIVACY_LEVELS, default: 'family' },
      hideDates: { type: Boolean, default: false },
    },

    generation: {
      number: { type: Number, default: null },
      status: { type: String, enum: GENERATION_STATUSES, default: 'pending' },
      candidates: { type: [Number], default: [] },
      override: {
        type: new Schema(
          {
            number: { type: Number, required: true, min: 1 },
            reason: { type: String, required: true, maxlength: 1000 },
            by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
        default: null,
      },
      computedAt: { type: Date, default: null },
    },

    /** Normalised (lower-case, accent-free) name tokens and prefixes for partial search. */
    searchTokens: { type: [String], default: [] },
    /** Phonetic keys for spelling-variation search. */
    phoneticKeys: { type: [String], default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** The GEDCOM import that added this person, so the import can be undone as a whole. */
    importBatchId: { type: Schema.Types.ObjectId, ref: 'FamilyImport', default: null },
    /** Set on a person merged into another: the person they became. */
    mergedInto: { type: Schema.Types.ObjectId, ref: 'FamilyMember', default: null },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'family_members', optimisticConcurrency: true, versionKey: 'version' },
);

FamilyMemberSchema.index({ familyId: 1, deletedAt: 1, 'generation.number': 1 });
FamilyMemberSchema.index({ familyId: 1, searchTokens: 1 });
FamilyMemberSchema.index({ familyId: 1, phoneticKeys: 1 });
FamilyMemberSchema.index({ familyId: 1, surname: 1, firstName: 1 });
// Default member list order (live people by name), so the first page needs no in-memory sort.
FamilyMemberSchema.index({ familyId: 1, deletedAt: 1, surname: 1, firstName: 1, _id: 1 });
FamilyMemberSchema.index({ familyId: 1, deletedAt: 1, 'birthDate.sortKey': 1, surname: 1, firstName: 1, _id: 1 });
FamilyMemberSchema.index({ familyId: 1, 'birthDate.year': 1 });
FamilyMemberSchema.index({ familyId: 1, hometown: 1 });
// A family ID belongs to one person, including removed ones (IDs are never reused).
FamilyMemberSchema.index({ familyId: 1, familyCode: 1 }, { unique: true, partialFilterExpression: { familyCode: { $type: 'string' } } });
FamilyMemberSchema.index({ familyId: 1, 'generation.status': 1 });
FamilyMemberSchema.index({ familyId: 1, importBatchId: 1 }, { partialFilterExpression: { importBatchId: { $type: 'objectId' } } });

export type FamilyMember = InferSchemaType<typeof FamilyMemberSchema>;
export type FamilyMemberDoc = ReturnType<(typeof FamilyMemberModel)['hydrate']>;
export const FamilyMemberModel = model('FamilyMember', FamilyMemberSchema);
