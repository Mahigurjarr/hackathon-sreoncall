import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { PlanLimits } from './tenant.model';

export interface IPlanDefinition {
  name: string;
  display_name: string;
  description: string;
  limits: PlanLimits;
  features: string[];
  price_monthly_cents: number;
  price_yearly_cents: number;
  stripe_price_id?: string;
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
}

export interface PlanDefinitionDocument extends IPlanDefinition, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const planLimitsSchema = new Schema<PlanLimits>(
  {
    // Existing limits
    max_users: { type: Number, default: 5 },
    max_tickets_per_month: { type: Number, default: 100 },
    max_storage_gb: { type: Number, default: 0.1 },
    api_rate_limit: { type: Number, default: 60 },
    custom_fields: { type: Boolean, default: false },
    sla_management: { type: Boolean, default: false },
    custom_workflows: { type: Boolean, default: false },
    audit_log_retention_days: { type: Number, default: 7 },
    agents_enabled: { type: Boolean, default: false },
    max_agents: { type: Number, default: 0 },
    // New numeric limits (-1 = unlimited)
    min_users: { type: Number, default: 0 },
    max_incidents_per_month: { type: Number, default: 50 },
    max_on_call_schedules: { type: Number, default: 1 },
    max_escalation_policies: { type: Number, default: 1 },
    max_notifications_per_day: { type: Number, default: 50 },
    observability_retention_days: { type: Number, default: 0 },
    max_synthetic_checks: { type: Number, default: 0 },
    max_status_pages: { type: Number, default: 1 },
    // v2 Communication
    max_sms_per_month: { type: Number, default: 0 },
    max_voice_per_month: { type: Number, default: 0 },
    max_whatsapp_per_month: { type: Number, default: 0 },
    // v2 Observability
    observability_log_ingestion_mbps: { type: Number, default: 0 },
    max_traces_per_day: { type: Number, default: 0 },
    observability_third_party_providers: { type: Number, default: 0 },
    // v2 Platform Config
    max_services: { type: Number, default: -1 },
    max_dashboards: { type: Number, default: 3 },
    max_alert_rules: { type: Number, default: 5 },
    max_slos: { type: Number, default: 0 },
    max_managed_tenants: { type: Number, default: 0 },
    // v2 AI
    max_ai_tokens_per_month: { type: Number, default: 0 },
    // Feature toggles
    sso_enabled: { type: Boolean, default: false },
    scim_enabled: { type: Boolean, default: false },
    mcp_enabled: { type: Boolean, default: false },
    voice_whatsapp_enabled: { type: Boolean, default: false },
    white_label_enabled: { type: Boolean, default: false },
    ai_rca_enabled: { type: Boolean, default: false },
    byos_enabled: { type: Boolean, default: false },
    notification_channels: { type: [String], default: ['email'] },
  },
  { _id: false }
);

const planDefinitionSchema = new Schema<PlanDefinitionDocument>(
  {
    name: { type: String, required: true, trim: true, lowercase: true, maxlength: 50 },
    display_name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 1000 },
    limits: { type: planLimitsSchema, default: () => ({}) },
    features: [{ type: String, trim: true }],
    price_monthly_cents: { type: Number, default: 0, min: 0 },
    price_yearly_cents: { type: Number, default: 0, min: 0 },
    stripe_price_id: { type: String },
    is_active: { type: Boolean, default: true },
    is_popular: { type: Boolean, default: false },
    sort_order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'plan-definitions',
  }
);

planDefinitionSchema.index({ name: 1 }, { unique: true });
planDefinitionSchema.index({ is_active: 1, sort_order: 1 });

export const PlanDefinition: Model<PlanDefinitionDocument> = mongoose.model<PlanDefinitionDocument>(
  'PlanDefinition',
  planDefinitionSchema
);
