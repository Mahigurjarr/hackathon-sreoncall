import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IChangeRequestBridge {
  consumer_tenant_id: Types.ObjectId;
  consumer_change_id: Types.ObjectId;
  provider_tenant_id: Types.ObjectId;
  provider_change_id: Types.ObjectId;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  escalated_at: Date;
  resolved_at: Date | null;
}

export interface ChangeRequestBridgeDocument extends IChangeRequestBridge, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const changeRequestBridgeSchema = new Schema<ChangeRequestBridgeDocument>(
  {
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    consumer_change_id: { type: Schema.Types.ObjectId, ref: 'ChangeRequest', required: true },
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    provider_change_id: { type: Schema.Types.ObjectId, ref: 'ChangeRequest', required: true },
    status:             { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
    escalated_at:       { type: Date, default: () => new Date() },
    resolved_at:        { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'change_request_bridges',
  }
);

changeRequestBridgeSchema.index({ consumer_tenant_id: 1, consumer_change_id: 1 });
changeRequestBridgeSchema.index({ provider_tenant_id: 1, provider_change_id: 1 });

export const ChangeRequestBridge: Model<ChangeRequestBridgeDocument> = mongoose.model<ChangeRequestBridgeDocument>(
  'ChangeRequestBridge',
  changeRequestBridgeSchema
);
