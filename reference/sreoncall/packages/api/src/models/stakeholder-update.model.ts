import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface DeliveryChannel {
  type: 'slack' | 'email' | 'status_page' | 'sms';
  target: string;
  sent_at: Date | null;
  delivery_status: 'pending' | 'sent' | 'failed';
}

export interface UpdateContent {
  draft: string;
  final: string | null;
  generated_by: 'ai' | 'manual';
}

export interface UpdateDelivery {
  channels: DeliveryChannel[];
}

export interface IStakeholderUpdate {
  tenant_id: Types.ObjectId;
  incident_id: Types.ObjectId;
  audience: 'internal_engineering' | 'internal_leadership' | 'external_customer' | 'status_page';
  content: UpdateContent;
  delivery: UpdateDelivery;
  status: 'draft' | 'sent';
  created_by: Types.ObjectId;
  sent_by: Types.ObjectId | null;
}

export interface StakeholderUpdateDocument extends IStakeholderUpdate, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryChannelSchema = new Schema<DeliveryChannel>(
  {
    type: {
      type: String,
      enum: ['slack', 'email', 'status_page', 'sms'],
      required: true,
    },
    target: { type: String, required: true },
    sent_at: { type: Date, default: null },
    delivery_status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },
  },
  { _id: false }
);

const contentSchema = new Schema<UpdateContent>(
  {
    draft: { type: String, required: true },
    final: { type: String, default: null },
    generated_by: {
      type: String,
      enum: ['ai', 'manual'],
      required: true,
    },
  },
  { _id: false }
);

const deliverySchema = new Schema<UpdateDelivery>(
  {
    channels: [deliveryChannelSchema],
  },
  { _id: false }
);

const stakeholderUpdateSchema = new Schema<StakeholderUpdateDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    audience: {
      type: String,
      enum: ['internal_engineering', 'internal_leadership', 'external_customer', 'status_page'],
      required: true,
    },
    content: { type: contentSchema, required: true },
    delivery: { type: deliverySchema, default: () => ({ channels: [] }) },
    status: {
      type: String,
      enum: ['draft', 'sent'],
      default: 'draft',
    },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sent_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    collection: 'stakeholder_updates',
  }
);

stakeholderUpdateSchema.index({ tenant_id: 1, incident_id: 1, createdAt: -1 });
stakeholderUpdateSchema.index({ tenant_id: 1, audience: 1 });

export const StakeholderUpdate: Model<StakeholderUpdateDocument> = mongoose.model<StakeholderUpdateDocument>(
  'StakeholderUpdate',
  stakeholderUpdateSchema
);
