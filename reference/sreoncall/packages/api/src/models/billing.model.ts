import mongoose, { Schema, Document, Model, Types } from 'mongoose';

// ─── Subscription ─────────────────────────────────────────────────────────────

export interface ISubscription {
  tenant_id: Types.ObjectId;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: 'free' | 'starter' | 'startup' | 'growth' | 'business' | 'pro' | 'enterprise';
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete' | 'incomplete_expired';
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end: boolean;
  seat_quantity: number;
  monthly_amount_cents: number;
}

export interface SubscriptionDocument extends ISubscription, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<SubscriptionDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    stripe_customer_id: { type: String, required: true },
    stripe_subscription_id: { type: String, required: true },
    plan: {
      type: String,
      enum: ['free', 'starter', 'startup', 'growth', 'business', 'pro', 'enterprise'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'past_due', 'canceled', 'trialing', 'incomplete', 'incomplete_expired'],
      default: 'active',
    },
    current_period_start: { type: Date, required: true },
    current_period_end: { type: Date, required: true },
    cancel_at_period_end: { type: Boolean, default: false },
    seat_quantity: { type: Number, default: 1 },
    monthly_amount_cents: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'subscriptions',
  }
);

subscriptionSchema.index({ tenant_id: 1 }, { unique: true });
subscriptionSchema.index({ stripe_subscription_id: 1 }, { unique: true });

export const Subscription: Model<SubscriptionDocument> = mongoose.model<SubscriptionDocument>(
  'Subscription',
  subscriptionSchema
);

// ─── Invoice ──────────────────────────────────────────────────────────────────

export interface IInvoice {
  tenant_id: Types.ObjectId;
  stripe_invoice_id: string;
  number: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  amount_cents: number;
  currency: string;
  period_start: Date;
  period_end: Date;
  pdf_url?: string;
  hosted_invoice_url?: string;
}

export interface InvoiceDocument extends IInvoice, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<InvoiceDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    stripe_invoice_id: { type: String, required: true },
    number: { type: String, required: true },
    status: {
      type: String,
      enum: ['draft', 'open', 'paid', 'void', 'uncollectible'],
      default: 'open',
    },
    amount_cents: { type: Number, required: true },
    currency: { type: String, default: 'usd' },
    period_start: { type: Date, required: true },
    period_end: { type: Date, required: true },
    pdf_url: String,
    hosted_invoice_url: String,
  },
  {
    timestamps: true,
    collection: 'invoices',
  }
);

invoiceSchema.index({ tenant_id: 1, createdAt: -1 });
invoiceSchema.index({ stripe_invoice_id: 1 }, { unique: true });

export const Invoice: Model<InvoiceDocument> = mongoose.model<InvoiceDocument>(
  'Invoice',
  invoiceSchema
);

// ─── Usage Record ─────────────────────────────────────────────────────────────

export interface IUsageRecord {
  tenant_id: Types.ObjectId;
  period: string; // 'YYYY-MM'
  users: number;
  tickets: number;
  incidents: number;
  storage_bytes: number;
  api_calls: number;
  agent_executions: number;
  agent_tokens_used: number;
  agent_cost_cents: number;
  // New tracked dimensions
  notifications_sent: number;       // monthly total; daily cap enforced via Redis
  on_call_schedules: number;        // snapshot: current active count
  escalation_policies: number;      // snapshot: current count
  synthetic_checks: number;         // snapshot: current active count
  status_pages: number;             // snapshot: current count
  agents: number;                   // snapshot: current count
  // New v2 metering fields
  sms_sent: number;
  voice_calls: number;
  whatsapp_sent: number;
  ai_tokens_used: number;           // canonical: all AI usage across all features
  dashboards: number;
  alert_rules: number;
  slos: number;
  services: number;
  traces_ingested: number;
  notetaker_minutes_used: number;
}

export interface UsageRecordDocument extends IUsageRecord, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const usageRecordSchema = new Schema<UsageRecordDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    period: { type: String, required: true },
    users: { type: Number, default: 0 },
    tickets: { type: Number, default: 0 },
    incidents: { type: Number, default: 0 },
    storage_bytes: { type: Number, default: 0 },
    api_calls: { type: Number, default: 0 },
    agent_executions: { type: Number, default: 0 },
    agent_tokens_used: { type: Number, default: 0 },
    agent_cost_cents: { type: Number, default: 0 },
    notifications_sent: { type: Number, default: 0 },
    on_call_schedules: { type: Number, default: 0 },
    escalation_policies: { type: Number, default: 0 },
    synthetic_checks: { type: Number, default: 0 },
    status_pages: { type: Number, default: 0 },
    agents: { type: Number, default: 0 },
    sms_sent: { type: Number, default: 0 },
    voice_calls: { type: Number, default: 0 },
    whatsapp_sent: { type: Number, default: 0 },
    ai_tokens_used: { type: Number, default: 0 },
    dashboards: { type: Number, default: 0 },
    alert_rules: { type: Number, default: 0 },
    slos: { type: Number, default: 0 },
    services: { type: Number, default: 0 },
    traces_ingested: { type: Number, default: 0 },
    notetaker_minutes_used: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'usage_records',
  }
);

usageRecordSchema.index({ tenant_id: 1, period: 1 }, { unique: true });

export const UsageRecord: Model<UsageRecordDocument> = mongoose.model<UsageRecordDocument>(
  'UsageRecord',
  usageRecordSchema
);

// ─── Billing Add-On ───────────────────────────────────────────────────────────

export type BillingAddOnType = 'managed_support';
export type BillingAddOnStatus = 'active' | 'canceled' | 'past_due';

export interface IBillingAddOn {
  tenant_id: Types.ObjectId;
  subscription_id: Types.ObjectId | null;
  type: BillingAddOnType;
  contract_id: Types.ObjectId;

  provider_tenant_id: Types.ObjectId;

  amount_cents: number;
  currency: string;
  provider_share_cents: number;
  platform_share_cents: number;

  status: BillingAddOnStatus;
  current_period_start: Date;
  current_period_end: Date;
  stripe_subscription_item_id: string | null;
}

export interface BillingAddOnDocument extends IBillingAddOn, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const billingAddOnSchema = new Schema<BillingAddOnDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    subscription_id: { type: Schema.Types.ObjectId, ref: 'Subscription', default: null },
    type: { type: String, enum: ['managed_support'], required: true },
    contract_id: { type: Schema.Types.ObjectId, ref: 'SupportContract', required: true },
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    amount_cents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'usd', lowercase: true },
    provider_share_cents: { type: Number, required: true, min: 0 },
    platform_share_cents: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['active', 'canceled', 'past_due'],
      default: 'active',
    },
    current_period_start: { type: Date, required: true },
    current_period_end: { type: Date, required: true },
    stripe_subscription_item_id: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'billing_add_ons',
  }
);

billingAddOnSchema.index({ tenant_id: 1, type: 1, status: 1 });
billingAddOnSchema.index({ contract_id: 1 });
billingAddOnSchema.index({ provider_tenant_id: 1, status: 1 });

export const BillingAddOn: Model<BillingAddOnDocument> = mongoose.model<BillingAddOnDocument>(
  'BillingAddOn',
  billingAddOnSchema
);
