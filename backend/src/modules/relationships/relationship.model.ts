import { Schema, model, type InferSchemaType } from 'mongoose';
import {
  PARENT_CHILD_SUBTYPES,
  PARTNERSHIP_STATUSES,
  PARTNERSHIP_SUBTYPES,
  RELATIONSHIP_TYPES,
  VERIFICATION_STATES,
} from '@fh/contracts';
import { FuzzyDateSchema, SourceReferenceSchema, softDeleteFields } from '../../core/schemas.js';

/**
 * An edge in the genealogy graph.
 * - parent_child: personA = parent, personB = child (directed)
 * - partnership:  personA < personB (ids sorted so each pair has one canonical form)
 * Siblings, grandparents, cousins etc. are derived and never stored.
 */
const RelationshipSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    type: { type: String, enum: RELATIONSHIP_TYPES, required: true },
    personA: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    personB: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    subtype: { type: String, enum: [...PARENT_CHILD_SUBTYPES, ...PARTNERSHIP_SUBTYPES], required: true },
    status: { type: String, enum: PARTNERSHIP_STATUSES, default: undefined },
    startDate: { type: FuzzyDateSchema, default: null },
    endDate: { type: FuzzyDateSchema, default: null },
    verification: { type: String, enum: VERIFICATION_STATES, default: 'unverified' },
    sources: { type: [SourceReferenceSchema], default: [] },
    notes: { type: String, default: '', maxlength: 5000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** The GEDCOM import that added this link. */
    importBatchId: { type: Schema.Types.ObjectId, ref: 'FamilyImport', default: null },
    ...softDeleteFields,
  },
  { timestamps: true, collection: 'relationships', optimisticConcurrency: true, versionKey: 'version' },
);

RelationshipSchema.pre('validate', function () {
  if (this.personA.equals(this.personB)) {
    this.invalidate('personB', 'A person cannot be related to themselves');
  }
  const subtypeValid =
    this.type === 'parent_child'
      ? (PARENT_CHILD_SUBTYPES as readonly string[]).includes(this.subtype)
      : (PARTNERSHIP_SUBTYPES as readonly string[]).includes(this.subtype);
  if (!subtypeValid) this.invalidate('subtype', `Subtype "${this.subtype}" is not valid for ${this.type}`);
  if (this.type === 'partnership' && this.personA.toString() > this.personB.toString()) {
    [this.personA, this.personB] = [this.personB, this.personA];
  }
});

RelationshipSchema.index(
  { familyId: 1, type: 1, personA: 1, personB: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
RelationshipSchema.index({ familyId: 1, personB: 1, type: 1 });
RelationshipSchema.index({ familyId: 1, personA: 1, type: 1 });
RelationshipSchema.index({ familyId: 1, importBatchId: 1 }, { partialFilterExpression: { importBatchId: { $type: 'objectId' } } });
// Covered scan used by the generation engine to load descent edges.
RelationshipSchema.index({ familyId: 1, type: 1, deletedAt: 1, verification: 1, subtype: 1, personA: 1, personB: 1 });

export type Relationship = InferSchemaType<typeof RelationshipSchema>;
export type RelationshipDoc = ReturnType<(typeof RelationshipModel)['hydrate']>;
export const RelationshipModel = model('Relationship', RelationshipSchema);
