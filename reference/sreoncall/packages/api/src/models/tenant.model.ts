import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface PasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_numbers: boolean;
  require_special: boolean;
  max_age_days: number;
  history_count: number;
}

export interface SessionPolicy {
  max_sessions: number;
  session_timeout_minutes: number;
  idle_timeout_minutes: number;
}

export interface AuthSettings {
  password_policy: PasswordPolicy;
  session_policy: SessionPolicy;
  sso_enabled: boolean;
  sso_provider?: string;
  sso_config?: Record<string, any>;
  mfa_required: boolean;
}

export interface Branding {
  logo_url?: string;
  favicon_url?: string;
  primary_color?: string;
  accent_color?: string;
}

export interface PlanLimits {
  // Existing limits
  max_users: number;
  max_tickets_per_month: number;
  max_storage_gb: number;
  api_rate_limit: number;
  custom_fields: boolean;
  sla_management: boolean;
  custom_workflows: boolean;
  audit_log_retention_days: number;
  agents_enabled: boolean;
  max_agents: number;
  // New limits (-1 = unlimited)
  min_users: number;
  max_incidents_per_month: number;
  max_on_call_schedules: number;
  max_escalation_policies: number;
  max_notifications_per_day: number;
  observability_retention_days: number;
  observability_series_limit: number;
  max_synthetic_checks: number;
  max_status_pages: number;
  // Feature toggles
  sso_enabled: boolean;
  scim_enabled: boolean;
  mcp_enabled: boolean;
  voice_whatsapp_enabled: boolean;
  white_label_enabled: boolean;
  notification_channels: string[];
  // ICC plan limits
  icc_enabled: boolean;
  service_dependencies_max: number;
  auto_discovery_enabled: boolean;
  document_upload_discovery: boolean;
  guided_resolution_enabled: boolean;
  resolution_ai_monthly_budget_cents: number;
  alert_quality_reports: boolean;
  business_impact_config: boolean;
  stakeholder_comms: boolean;
  predictive_alerts: boolean;
  toil_tracking: boolean;
  validation_suites_max: number;
  compliance_aware_response: boolean;
  // New fields added for pricing v2
  max_services: number;
  max_sms_per_month: number;
  max_voice_per_month: number;
  max_whatsapp_per_month: number;
  max_ai_tokens_per_month: number;
  max_dashboards: number;
  max_alert_rules: number;
  max_slos: number;
  max_traces_per_day: number;
  observability_log_ingestion_mbps: number;
  max_managed_tenants: number;
  ai_rca_enabled: boolean;
  byos_enabled: boolean;
  observability_third_party_providers: number;
  // AI Notetaker
  ai_notetaker_enabled: boolean;
  max_notetaker_minutes_per_month: number;
}

export type TenantType = 'standalone' | 'provider' | 'consumer' | 'platform';

export interface PendingPlanChange {
  previous_plan: string;
  new_plan: string;
  changed_at: Date;
  changed_by: 'admin' | 'stripe' | 'self' | 'activation_code';
  acknowledged: boolean;
  acknowledged_at?: Date;
  acknowledged_by?: string;
}

export interface VoiceCallSettings {
  greeting?: string;
}

export interface NotificationOverrides {
  // When true, voice/SMS dispatch ignores per-user notification_preferences and
  // pages anyone with a phone_number. Tenant-level "always page on-call" switch.
  force_voice: boolean;
  force_sms: boolean;
}

export interface ITenant {
  slug: string;
  name: string;
  type: TenantType;
  status: 'active' | 'suspended' | 'provisioning' | 'deleted';
  plan: 'free' | 'starter' | 'startup' | 'growth' | 'business' | 'pro' | 'enterprise';
  plan_limits: PlanLimits;
  auth_settings: AuthSettings;
  branding: Branding;
  voice_call_settings: VoiceCallSettings;
  notification_overrides: NotificationOverrides;
  custom_domains: string[];
  website?: string;
  stripe_customer_id?: string;
  is_platform_tenant: boolean;
  pending_plan_change?: PendingPlanChange;
  deleted_at?: Date;
  ai_config: {
    provider: 'openai' | 'anthropic' | 'google' | null;
    model: string | null;
    api_key_encrypted: string | null;
    api_key_hint: string | null;
    configured_by: Schema.Types.ObjectId | null;
    configured_at: Date | null;
  };
}

export interface TenantDocument extends ITenant, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const passwordPolicySchema = new Schema<PasswordPolicy>(
  {
    min_length: { type: Number, default: 8 },
    require_uppercase: { type: Boolean, default: true },
    require_lowercase: { type: Boolean, default: true },
    require_numbers: { type: Boolean, default: true },
    require_special: { type: Boolean, default: false },
    max_age_days: { type: Number, default: 90 },
    history_count: { type: Number, default: 5 },
  },
  { _id: false }
);

const sessionPolicySchema = new Schema<SessionPolicy>(
  {
    max_sessions: { type: Number, default: 5 },
    session_timeout_minutes: { type: Number, default: 480 },
    idle_timeout_minutes: { type: Number, default: 30 },
  },
  { _id: false }
);

const authSettingsSchema = new Schema<AuthSettings>(
  {
    password_policy: { type: passwordPolicySchema, default: () => ({}) },
    session_policy: { type: sessionPolicySchema, default: () => ({}) },
    sso_enabled: { type: Boolean, default: false },
    sso_provider: { type: String },
    sso_config: { type: Schema.Types.Mixed },
    mfa_required: { type: Boolean, default: false },
  },
  { _id: false }
);

const brandingSchema = new Schema<Branding>(
  {
    logo_url: String,
    favicon_url: String,
    primary_color: { type: String, default: '#4F46E5' },
    accent_color: { type: String, default: '#10B981' },
  },
  { _id: false }
);

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
    observability_retention_days: { type: Number, default: 7 },
    observability_series_limit: { type: Number, default: 100_000 },
    max_synthetic_checks: { type: Number, default: 0 },
    max_status_pages: { type: Number, default: 1 },
    // Feature toggles
    sso_enabled: { type: Boolean, default: false },
    scim_enabled: { type: Boolean, default: false },
    mcp_enabled: { type: Boolean, default: false },
    voice_whatsapp_enabled: { type: Boolean, default: false },
    white_label_enabled: { type: Boolean, default: false },
    notification_channels: { type: [String], default: ['email'] },
    // ICC plan limits
    icc_enabled: { type: Boolean, default: false },
    service_dependencies_max: { type: Number, default: 0 },
    auto_discovery_enabled: { type: Boolean, default: false },
    document_upload_discovery: { type: Boolean, default: false },
    guided_resolution_enabled: { type: Boolean, default: false },
    resolution_ai_monthly_budget_cents: { type: Number, default: 0 },
    alert_quality_reports: { type: Boolean, default: false },
    business_impact_config: { type: Boolean, default: false },
    stakeholder_comms: { type: Boolean, default: false },
    predictive_alerts: { type: Boolean, default: false },
    toil_tracking: { type: Boolean, default: false },
    validation_suites_max: { type: Number, default: 0 },
    compliance_aware_response: { type: Boolean, default: false },
    // v2 pricing fields
    max_services: { type: Number, default: -1 },
    max_sms_per_month: { type: Number, default: 0 },
    max_voice_per_month: { type: Number, default: 0 },
    max_whatsapp_per_month: { type: Number, default: 0 },
    max_ai_tokens_per_month: { type: Number, default: 0 },
    max_dashboards: { type: Number, default: 3 },
    max_alert_rules: { type: Number, default: 5 },
    max_slos: { type: Number, default: 0 },
    max_traces_per_day: { type: Number, default: 5000 },
    observability_log_ingestion_mbps: { type: Number, default: 1 },
    max_managed_tenants: { type: Number, default: 0 },
    ai_rca_enabled: { type: Boolean, default: false },
    byos_enabled: { type: Boolean, default: false },
    observability_third_party_providers: { type: Number, default: 0 },
    // AI Notetaker (0 = disabled, -1 = unlimited minutes)
    ai_notetaker_enabled: { type: Boolean, default: false },
    max_notetaker_minutes_per_month: { type: Number, default: 0 },
  },
  { _id: false }
);

const aiConfigSchema = new Schema<{
  provider: 'openai' | 'anthropic' | 'google' | null;
  model: string | null;
  api_key_encrypted: string | null;
  api_key_hint: string | null;
  configured_by: Schema.Types.ObjectId | null;
  configured_at: Date | null;
}>(
  {
    provider: { type: String, default: null },
    model: { type: String, default: null },
    api_key_encrypted: { type: String, default: null },
    api_key_hint: { type: String, default: null },
    configured_by: { type: Schema.Types.ObjectId, default: null },
    configured_at: { type: Date, default: null },
  },
  { _id: false }
);

const tenantSchema = new Schema<TenantDocument>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: {
      type: String,
      enum: ['standalone', 'provider', 'consumer', 'platform'],
      default: 'standalone',
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'provisioning', 'deleted'],
      default: 'active',
    },
    plan: {
      type: String,
      enum: ['free', 'starter', 'startup', 'growth', 'business', 'pro', 'enterprise'],
      default: 'free',
    },
    plan_limits: { type: planLimitsSchema, default: () => ({}) },
    auth_settings: { type: authSettingsSchema, default: () => ({}) },
    branding: { type: brandingSchema, default: () => ({}) },
    voice_call_settings: {
      type: new Schema<VoiceCallSettings>(
        {
          greeting: { type: String, maxlength: 500, default: 'Hello. You have a notification from SRE on Call.' },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    notification_overrides: {
      type: new Schema<NotificationOverrides>(
        {
          force_voice: { type: Boolean, default: false },
          force_sms: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    custom_domains: [{ type: String }],
    website: { type: String, trim: true, maxlength: 2048 },
    stripe_customer_id: String,
    is_platform_tenant: { type: Boolean, default: false },
    pending_plan_change: {
      type: new Schema({
        previous_plan: { type: String, required: true },
        new_plan: { type: String, required: true },
        changed_at: { type: Date, required: true },
        changed_by: { type: String, enum: ['admin', 'stripe', 'self', 'activation_code'], required: true },
        acknowledged: { type: Boolean, default: false },
        acknowledged_at: Date,
        acknowledged_by: String,
      }, { _id: false }),
      default: undefined,
    },
    deleted_at: Date,
    ai_config: { type: aiConfigSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    collection: 'tenants',
  }
);

tenantSchema.index({ status: 1 });
tenantSchema.index({ type: 1, status: 1 });

// Soft delete: filter out deleted tenants by default
tenantSchema.pre('find', function () {
  if (!(this.getFilter() as any).status) {
    this.where({ deleted_at: { $eq: null } });
  }
});

tenantSchema.pre('findOne', function () {
  if (!(this.getFilter() as any).status) {
    this.where({ deleted_at: { $eq: null } });
  }
});

export const Tenant: Model<TenantDocument> = mongoose.model<TenantDocument>('Tenant', tenantSchema);
