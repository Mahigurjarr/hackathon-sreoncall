import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IConsumerManagedTier {
  contract_id: Types.ObjectId;
  consumer_tenant_id: Types.ObjectId;
  level: number;
  name: string;
  schedule_id: Types.ObjectId;
  notify_channels: string[];
  escalation_timeout_minutes: number | null;
}

export interface ConsumerManagedTierDocument extends IConsumerManagedTier, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ConsumerManagedTierDocument>(
  {
    contract_id: { type: Schema.Types.ObjectId, ref: 'SupportContract', required: true },
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    level: { type: Number, required: true, min: 2 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    schedule_id: { type: Schema.Types.ObjectId, ref: 'OnCallSchedule', required: true },
    escalation_timeout_minutes: { type: Number, default: null, min: 1 },
    notify_channels: {
      type: [String],
      enum: ['email', 'sms', 'slack', 'voice', 'whatsapp', 'in_app'],
      default: ['in_app', 'voice'],
    },
  },
  { timestamps: true, collection: 'consumer_managed_tiers' }
);

schema.index({ contract_id: 1, consumer_tenant_id: 1 });

export const ConsumerManagedTier: Model<ConsumerManagedTierDocument> =
  mongoose.model<ConsumerManagedTierDocument>('ConsumerManagedTier', schema);
