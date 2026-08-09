import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IProviderConsumerLink {
  provider_tenant_id: Types.ObjectId;
  consumer_tenant_id: Types.ObjectId;
  status: 'active' | 'pending' | 'suspended';
  scope: string[];
  created_by: Types.ObjectId;
}

export interface ProviderConsumerLinkDocument extends IProviderConsumerLink, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const providerConsumerLinkSchema = new Schema<ProviderConsumerLinkDocument>(
  {
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    status: {
      type: String,
      enum: ['active', 'pending', 'suspended'],
      default: 'pending',
    },
    scope: [{ type: String, enum: ['incidents', 'escalations', 'oncall', 'runbooks', 'communications', 'tickets', 'changes', 'managed_support', 'observability'] }],
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'provider-consumer-links',
  }
);

providerConsumerLinkSchema.index({ provider_tenant_id: 1 });
providerConsumerLinkSchema.index({ consumer_tenant_id: 1 }, { unique: true });
providerConsumerLinkSchema.index({ provider_tenant_id: 1, status: 1 });

export const ProviderConsumerLink: Model<ProviderConsumerLinkDocument> = mongoose.model<ProviderConsumerLinkDocument>(
  'ProviderConsumerLink',
  providerConsumerLinkSchema
);
