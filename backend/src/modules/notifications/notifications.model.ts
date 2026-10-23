import { Schema, model } from 'mongoose';

/** A browser or phone where an account receives notifications (Web Push). */
const PushSubscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    endpoint: { type: String, required: true, maxlength: 2000 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 200 },
      auth: { type: String, required: true, maxlength: 100 },
    },
    userAgent: { type: String, default: '', maxlength: 300 },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'push_subscriptions' },
);
PushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });
PushSubscriptionSchema.index({ userId: 1 });
export const PushSubscriptionModel = model('PushSubscription', PushSubscriptionSchema);

/**
 * One reminder sent (or decided to be empty): the weekly e-mail for an ISO week, or the notification
 * for a local day. The unique index makes the hourly reminder run idempotent, even with several workers.
 */
const NotificationDeliverySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['digest', 'push'], required: true },
    /** "2026-W43" for the weekly e-mail, "2026-10-19" for a day's notification. */
    key: { type: String, required: true, maxlength: 20 },
    sent: { type: Boolean, default: false },
    createdAt: { type: Date, default: () => new Date() },
  },
  { collection: 'notification_deliveries' },
);
NotificationDeliverySchema.index({ userId: 1, kind: 1, key: 1 }, { unique: true });
NotificationDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 3600 });
export const NotificationDeliveryModel = model('NotificationDelivery', NotificationDeliverySchema);
