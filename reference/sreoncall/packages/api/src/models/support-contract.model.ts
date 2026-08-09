import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type SupportContractStatus = 'draft' | 'active' | 'amended' | 'expired' | 'canceled';
export type CoverageType = '8x5' | '24x7' | 'custom';
export type TierLevel = 1 | 2 | 3;
export type SlaSeverity = 1 | 2 | 3 | 4 | 5;

export interface ICoverageWindow {
  type: CoverageType;
  timezone: string;
  schedule: Array<{
    day: number;
    start: string;
    end: string;
  }>;
}

export type TierNotifyChannel = 'email' | 'sms' | 'slack' | 'voice' | 'whatsapp' | 'in_app';

export interface ISupportTier {
  level: TierLevel;
  name: string;
  schedule_id?: Types.ObjectId;    // legacy single-schedule
  schedule_ids?: Types.ObjectId[]; // multi-schedule follow-the-sun
  escalation_timeout_minutes: number | null;
  notify_channels: TierNotifyChannel[];
}

export interface ISupportSlaTarget {
  severity: SlaSeverity;
  response_minutes: number;
  resolution_minutes: number;
}

export interface ISupportPricing {
  amount_cents: number;
  currency: string;
  provider_share_pct: number;
  platform_share_pct: number;
}

export interface ISupportContract {
  tenant_id: Types.ObjectId;
  link_id: Types.ObjectId;
  consumer_tenant_id: Types.ObjectId;

  name: string;
  status: SupportContractStatus;

  coverage_window: ICoverageWindow;
  tiers: ISupportTier[];
  sla_targets: ISupportSlaTarget[];
  pricing: ISupportPricing;

  effective_from: Date;
  effective_until: Date | null;
  predecessor_contract_id: Types.ObjectId | null;

  created_by: Types.ObjectId;
}

export interface SupportContractDocument extends ISupportContract, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const coverageWindowSchema = new Schema<ICoverageWindow>(
  {
    type: { type: String, enum: ['8x5', '24x7', 'custom'], required: true },
    timezone: { type: String, required: true, default: 'UTC' },
    schedule: [
      {
        day: { type: Number, min: 0, max: 6, required: true },
        start: { type: String, required: true },
        end: { type: String, required: true },
      },
    ],
  },
  { _id: false }
);

const supportTierSchema = new Schema<ISupportTier>(
  {
    level: { type: Number, enum: [1, 2, 3], required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    schedule_id: { type: Schema.Types.ObjectId, ref: 'OnCallSchedule', default: null },
    schedule_ids: { type: [{ type: Schema.Types.ObjectId, ref: 'OnCallSchedule' }], default: undefined },
    escalation_timeout_minutes: { type: Number, default: null, min: 1 },
    notify_channels: {
      type: [String],
      enum: ['email', 'sms', 'slack', 'voice', 'whatsapp', 'in_app'],
      default: ['in_app', 'email'],
    },
  },
  { _id: false }
);

const slaTargetSchema = new Schema<ISupportSlaTarget>(
  {
    severity: { type: Number, enum: [1, 2, 3, 4, 5], required: true },
    response_minutes: { type: Number, required: true, min: 1 },
    resolution_minutes: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const pricingSchema = new Schema<ISupportPricing>(
  {
    amount_cents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'usd', lowercase: true },
    provider_share_pct: { type: Number, required: true, min: 0, max: 100, default: 80 },
    platform_share_pct: { type: Number, required: true, min: 0, max: 100, default: 20 },
  },
  { _id: false }
);

const supportContractSchema = new Schema<SupportContractDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    link_id: { type: Schema.Types.ObjectId, ref: 'ProviderConsumerLink', required: true },
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    status: {
      type: String,
      enum: ['draft', 'active', 'amended', 'expired', 'canceled'],
      default: 'draft',
    },
    coverage_window: { type: coverageWindowSchema, required: true },
    tiers: { type: [supportTierSchema], default: [] },
    sla_targets: { type: [slaTargetSchema], default: [] },
    pricing: { type: pricingSchema, required: true },
    effective_from: { type: Date, required: true },
    effective_until: { type: Date, default: null },
    predecessor_contract_id: { type: Schema.Types.ObjectId, ref: 'SupportContract', default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'support_contracts',
  }
);

supportContractSchema.index({ link_id: 1, status: 1 });
supportContractSchema.index({ consumer_tenant_id: 1, status: 1 });
supportContractSchema.index({ tenant_id: 1, status: 1 });

export const SupportContract: Model<SupportContractDocument> = mongoose.model<SupportContractDocument>(
  'SupportContract',
  supportContractSchema
);
