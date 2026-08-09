import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ICommunicationMessage {
  thread_id: Types.ObjectId;
  provider_tenant_id: Types.ObjectId;
  consumer_tenant_id: Types.ObjectId;
  origin: 'provider' | 'consumer_slack' | 'consumer_teams';
  sender_user_id?: string;
  sender_display_name: string;
  body: string;
  tag?: 'question' | 'request' | 'update' | 'fyi';
  delivery_status: 'pending' | 'delivered' | 'failed';
  external_message_id?: string;
  read_by_provider: boolean;
  read_at?: Date | null;
  sent_at: Date;
}

export interface CommunicationMessageDocument extends ICommunicationMessage, Document {
  _id: Types.ObjectId;
}

const communicationMessageSchema = new Schema<CommunicationMessageDocument>(
  {
    thread_id: { type: Schema.Types.ObjectId, ref: 'CommunicationThread', required: true },
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    origin: {
      type: String,
      enum: ['provider', 'consumer_slack', 'consumer_teams'],
      required: true,
    },
    sender_user_id: { type: String },
    sender_display_name: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 10000 },
    tag: {
      type: String,
      enum: ['question', 'request', 'update', 'fyi'],
    },
    delivery_status: {
      type: String,
      enum: ['pending', 'delivered', 'failed'],
      default: 'pending',
    },
    external_message_id: { type: String },
    read_by_provider: { type: Boolean, default: false },
    read_at: { type: Date, default: null },
    sent_at: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    collection: 'communication-messages',
  }
);

// Thread messages sorted by time
communicationMessageSchema.index({ thread_id: 1, sent_at: 1 });
// TTL: auto-purge messages older than 180 days
communicationMessageSchema.index({ sent_at: 1 }, { expireAfterSeconds: 15552000 });

export const CommunicationMessage: Model<CommunicationMessageDocument> = mongoose.model<CommunicationMessageDocument>(
  'CommunicationMessage',
  communicationMessageSchema
);
