import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ICommunicationThread {
  provider_tenant_id: Types.ObjectId;
  consumer_tenant_id: Types.ObjectId;
  channel_id: Types.ObjectId;
  subject: string;
  status: 'open' | 'closed';
  tag?: 'question' | 'request' | 'update' | 'fyi';
  unread_by_provider: number;
  last_message_at: Date;
  external_thread_id?: string;
  initiated_by: 'provider' | 'consumer';
}

export interface CommunicationThreadDocument extends ICommunicationThread, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const communicationThreadSchema = new Schema<CommunicationThreadDocument>(
  {
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    channel_id: { type: Schema.Types.ObjectId, ref: 'CommunicationChannel', required: true },
    subject: { type: String, required: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
    },
    tag: {
      type: String,
      enum: ['question', 'request', 'update', 'fyi'],
    },
    unread_by_provider: { type: Number, default: 0 },
    last_message_at: { type: Date, default: Date.now },
    external_thread_id: { type: String },
    initiated_by: {
      type: String,
      enum: ['provider', 'consumer'],
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'communication-threads',
  }
);

// Primary inbox query: provider's open threads sorted by recency
communicationThreadSchema.index({ provider_tenant_id: 1, status: 1, last_message_at: -1 });
// Consumer-scoped thread lookup
communicationThreadSchema.index({ provider_tenant_id: 1, consumer_tenant_id: 1, status: 1, last_message_at: -1 });
// Channel-based lookup for inbound matching
communicationThreadSchema.index({ channel_id: 1, external_thread_id: 1 });

export const CommunicationThread: Model<CommunicationThreadDocument> = mongoose.model<CommunicationThreadDocument>(
  'CommunicationThread',
  communicationThreadSchema
);
