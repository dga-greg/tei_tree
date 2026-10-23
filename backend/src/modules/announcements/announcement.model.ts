import { Schema, model, type InferSchemaType } from 'mongoose';
import { ANNOUNCE_CHANNELS } from '@fh/contracts';

const delivery = { type: String, enum: ['sent', 'failed', 'skipped'], default: undefined };

/** One person an announcement went to, how it reached them, and their answer. */
const RecipientSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember', required: true },
    /** Normalised (233…); null when the person has no usable number. */
    phone: { type: String, default: null },
    /** The account linked to the person, for e-mail and app notifications. */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** Hash of the personal link's token (attendance and stopping messages). */
    tokenHash: { type: String, required: true },
    delivery: { sms: delivery, whatsapp: delivery, email: delivery, push: delivery },
    error: { type: String, default: null, maxlength: 300 },
    rsvp: { type: String, enum: ['yes', 'no', null], default: null },
    rsvpAt: { type: Date, default: null },
    remindedAt: { type: Date, default: null },
  },
  { _id: false },
);

/** A message about a ceremony, sent to a chosen set of relatives on chosen channels. */
const AnnouncementSchema = new Schema(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'FamilyEvent', required: true },
    message: { type: String, required: true, maxlength: 1000 },
    /** Words before the personal link, and the reminder, in the sender's language. */
    linkLabel: { type: String, default: null, maxlength: 80 },
    reminderMessage: { type: String, default: null, maxlength: 300 },
    channels: { type: [String], enum: ANNOUNCE_CHANNELS, default: [] },
    audience: { kind: { type: String, enum: ['all', 'branch', 'people'], required: true }, label: { type: String, default: '' } },
    rsvp: { type: Boolean, default: true },
    remind: { type: Boolean, default: false },
    /** When the day-before reminder is due; null without a full date. */
    remindAt: { type: Date, default: null },
    reminderSentAt: { type: Date, default: null },
    /** When the attendance link stops taking answers. */
    closesAt: { type: Date, default: null },
    status: { type: String, enum: ['scheduled', 'sending', 'sent'], default: 'scheduled' },
    scheduledFor: { type: Date, required: true },
    /** SMS parts used (for the family's monthly limit). */
    smsParts: { type: Number, default: 0 },
    recipients: { type: [RecipientSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'family_announcements' },
);
AnnouncementSchema.index({ familyId: 1, eventId: 1, createdAt: -1 });
AnnouncementSchema.index({ 'recipients.tokenHash': 1 });
AnnouncementSchema.index({ status: 1, scheduledFor: 1 });
AnnouncementSchema.index({ remind: 1, reminderSentAt: 1, remindAt: 1 });

export type Announcement = InferSchemaType<typeof AnnouncementSchema>;
export const AnnouncementModel = model('FamilyAnnouncement', AnnouncementSchema);
export type AnnouncementDoc = InstanceType<typeof AnnouncementModel>;
