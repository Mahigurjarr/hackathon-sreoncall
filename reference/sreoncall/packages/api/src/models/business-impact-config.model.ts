import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface CustomerTier {
  tier: string;
  count: number;
  sla_commitment: string | null;
}

export interface IBusinessImpactConfig {
  tenant_id: Types.ObjectId;
  service_id: Types.ObjectId;
  revenue_per_request_cents: number | null;
  avg_requests_per_minute: number | null;
  affected_user_scope: 'all' | 'subset' | 'internal_only';
  estimated_users_affected_percent: number;
  total_user_count: number | null;
  customer_tiers: CustomerTier[];
  sla_config_id: Types.ObjectId | null;
  support_escalation_threshold_minutes: number | null;
  notes: string | null;
  updated_by: Types.ObjectId;
}

export interface BusinessImpactConfigDocument extends IBusinessImpactConfig, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const customerTierSchema = new Schema<CustomerTier>(
  {
    tier: { type: String, required: true },
    count: { type: Number, required: true },
    sla_commitment: { type: String, default: null },
  },
  { _id: false }
);

const businessImpactConfigSchema = new Schema<BusinessImpactConfigDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    service_id: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    revenue_per_request_cents: { type: Number, default: null },
    avg_requests_per_minute: { type: Number, default: null },
    affected_user_scope: {
      type: String,
      enum: ['all', 'subset', 'internal_only'],
      default: 'all',
    },
    estimated_users_affected_percent: { type: Number, default: 100, min: 0, max: 100 },
    total_user_count: { type: Number, default: null },
    customer_tiers: [customerTierSchema],
    sla_config_id: { type: Schema.Types.ObjectId, ref: 'SlaConfig', default: null },
    support_escalation_threshold_minutes: { type: Number, default: null },
    notes: { type: String, default: null },
    updated_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'business_impact_configs',
  }
);

businessImpactConfigSchema.index(
  { tenant_id: 1, service_id: 1 },
  { unique: true }
);

export const BusinessImpactConfig: Model<BusinessImpactConfigDocument> = mongoose.model<BusinessImpactConfigDocument>(
  'BusinessImpactConfig',
  businessImpactConfigSchema
);
