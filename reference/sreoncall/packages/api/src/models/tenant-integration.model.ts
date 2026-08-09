import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type IntegrationPlatform = 'slack' | 'teams';

export interface ITenantIntegration {
  tenant_id: Types.ObjectId;
  platform: IntegrationPlatform;
  bot_token_encrypted: string;
  workspace_id?: string;
  is_active: boolean;
  created_by: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export interface TenantIntegrationDocument extends ITenantIntegration, Document {
  _id: Types.ObjectId;
}

const tenantIntegrationSchema = new Schema<TenantIntegrationDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    platform: { type: String, enum: ['slack', 'teams'], required: true },
    bot_token_encrypted: { type: String, required: true },
    workspace_id: { type: String, default: null },
    is_active: { type: Boolean, default: true },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'tenant-integrations',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

tenantIntegrationSchema.index({ tenant_id: 1, platform: 1 }, { unique: true });

export const TenantIntegration: Model<TenantIntegrationDocument> = mongoose.model<TenantIntegrationDocument>(
  'TenantIntegration',
  tenantIntegrationSchema
);
