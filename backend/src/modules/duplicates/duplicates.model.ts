import { Schema, model, type InferSchemaType } from 'mongoose';
import { IMPORT_STATUSES } from '@fh/contracts';

/** Two people an administrator said are not the same person; the duplicate finder stops suggesting them. */
const DuplicateDismissalSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    /** The pair, smaller id first. */
    a: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    b: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'duplicate_dismissals' },
);
DuplicateDismissalSchema.index({ familyId: 1, a: 1, b: 1 }, { unique: true });

export const DuplicateDismissalModel = model('DuplicateDismissal', DuplicateDismissalSchema);

const IdList = { type: [Schema.Types.ObjectId], default: [] };

/**
 * A merge of one person (`otherId`) into another (`keepId`), with everything needed to undo it:
 * the kept person's details before, each link moved or removed, and each reference rewritten.
 */
const MemberMergeSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    keepId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    otherId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    otherName: { type: String, required: true },
    status: { type: String, enum: IMPORT_STATUSES, default: 'active' },
    /** The kept person's stored details before the merge, and their version after it. */
    keepBefore: { type: Schema.Types.Mixed, required: true },
    keepVersionAfter: { type: Number, required: true },
    links: {
      type: [
        new Schema(
          {
            edgeId: { type: Schema.Types.ObjectId, required: true },
            change: { type: String, enum: ['moved', 'removed'], required: true },
            personA: { type: Schema.Types.ObjectId, required: true },
            personB: { type: Schema.Types.ObjectId, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /** Archive items where the other person was replaced by the kept one, or only removed (both were tagged). */
    replaced: { media: IdList, stories: IdList, events: IdList },
    pulled: { media: IdList, stories: IdList, events: IdList },
    /** Photo tags of the other person: moved to the kept person, or removed where both were tagged (with the box, to put back). */
    photoTags: {
      type: [new Schema({ mediaId: { type: Schema.Types.ObjectId, required: true }, change: { type: String, enum: ['moved', 'removed'], required: true }, box: Schema.Types.Mixed }, { _id: false })],
      default: [],
    },
    membershipId: { type: Schema.Types.ObjectId, default: null },
    founderMoved: { type: Boolean, default: false },
    branchIds: IdList,
    invitationIds: IdList,
    contributionIds: IdList,
    removedAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    undoneAt: { type: Date, default: null },
    undoneBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, collection: 'member_merges' },
);
MemberMergeSchema.index({ familyId: 1, createdAt: -1 });

export type MemberMerge = InferSchemaType<typeof MemberMergeSchema>;
export const MemberMergeModel = model('MemberMerge', MemberMergeSchema);
