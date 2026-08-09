import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IStatusPageSubscriber {
  tenant_id: Types.ObjectId;
  status_page_id: Types.ObjectId;
  channel: 'email' | 'sms' | 'webhook';
  email: string;
  phone?: string;
  webhook_url?: string;
  confirmed: boolean;
  confirm_token: string;
  unsubscribe_token: string;
  consent_given: boolean;
  consent_given_at?: Date;
  created_at: Date;
}

export interface StatusPageSubscriberDocument extends IStatusPageSubscriber, Document {
  _id: Types.ObjectId;
}

const statusPageSubscriberSchema = new Schema<StatusPageSubscriberDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    status_page_id: { type: Schema.Types.ObjectId, ref: 'StatusPage', required: true },
    channel: { type: String, enum: ['email', 'sms', 'webhook'], default: 'email' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    webhook_url: { type: String, trim: true, default: '' },
    confirmed: { type: Boolean, default: false },
    confirm_token: { type: String, required: true },
    unsubscribe_token: { type: String, required: true },
    consent_given: { type: Boolean, default: false },
    consent_given_at: { type: Date },
  },
  {
    collection: 'status_page_subscribers',
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

// Unique per channel: email subscribers by email, SMS by phone, webhook by URL
statusPageSubscriberSchema.index(
  { status_page_id: 1, channel: 1, email: 1 },
  { unique: true, partialFilterExpression: { channel: 'email', email: { $ne: '' } } }
);
statusPageSubscriberSchema.index(
  { status_page_id: 1, channel: 1, phone: 1 },
  { unique: true, partialFilterExpression: { channel: 'sms', phone: { $ne: '' } } }
);
statusPageSubscriberSchema.index(
  { status_page_id: 1, channel: 1, webhook_url: 1 },
  { unique: true, partialFilterExpression: { channel: 'webhook', webhook_url: { $ne: '' } } }
);
statusPageSubscriberSchema.index({ confirm_token: 1 });
statusPageSubscriberSchema.index({ unsubscribe_token: 1 });

export const StatusPageSubscriber: Model<StatusPageSubscriberDocument> =
  mongoose.model<StatusPageSubscriberDocument>('StatusPageSubscriber', statusPageSubscriberSchema);
