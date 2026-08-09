import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type AutonomyLevel = 'observe' | 'recommend' | 'auto_low' | 'auto_full';
export type RiskThreshold = 'low' | 'medium' | 'high' | 'critical';

export interface QuietHours {
  enabled: boolean;
  start_hour: number;
  end_hour: number;
  days: number[];
}

export interface AgentConfiguration {
  max_actions_per_execution: number;
  max_executions_per_hour: number;
  monthly_token_budget: number;
  monthly_cost_budget_cents: number;
  require_approval_above_risk: RiskThreshold;
  blocked_actions: string[];
  quiet_hours: QuietHours;
}

export interface ConsumerOverride {
  consumer_tenant_id: Types.ObjectId;
  enabled: boolean;
  autonomy_level?: AutonomyLevel;
  configuration?: Partial<AgentConfiguration>;
}

export interface IAgentInstallation {
  tenant_id: Types.ObjectId;
  agent_definition_id: Types.ObjectId;
  agent_slug: string;
  enabled: boolean;
  autonomy_level: AutonomyLevel;
  configuration: AgentConfiguration;
  consumer_overrides: ConsumerOverride[];
  stripe_subscription_item_id?: string;
  installed_by: Types.ObjectId;
  installed_at: Date;
}

export interface AgentInstallationDocument extends IAgentInstallation, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const quietHoursSchema = new Schema<QuietHours>(
  {
    enabled: { type: Boolean, default: false },
    start_hour: { type: Number, default: 22, min: 0, max: 23 },
    end_hour: { type: Number, default: 6, min: 0, max: 23 },
    days: [{ type: Number, min: 0, max: 6 }],
  },
  { _id: false }
);

const agentConfigurationSchema = new Schema<AgentConfiguration>(
  {
    max_actions_per_execution: { type: Number, default: 5, min: 1, max: 50 },
    max_executions_per_hour: { type: Number, default: 50, min: 1, max: 1000 },
    monthly_token_budget: { type: Number, default: 1_000_000, min: 0 },
    monthly_cost_budget_cents: { type: Number, default: 10_000, min: 0 },
    require_approval_above_risk: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    blocked_actions: [{ type: String, trim: true }],
    quiet_hours: { type: quietHoursSchema, default: () => ({}) },
  },
  { _id: false }
);

const consumerOverrideSchema = new Schema<ConsumerOverride>(
  {
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    enabled: { type: Boolean, default: true },
    autonomy_level: {
      type: String,
      enum: ['observe', 'recommend', 'auto_low', 'auto_full'],
    },
    configuration: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const agentInstallationSchema = new Schema<AgentInstallationDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    agent_definition_id: { type: Schema.Types.ObjectId, ref: 'AgentDefinition', required: true },
    agent_slug: { type: String, required: true, lowercase: true, trim: true },
    enabled: { type: Boolean, default: true },
    autonomy_level: {
      type: String,
      enum: ['observe', 'recommend', 'auto_low', 'auto_full'],
      default: 'recommend',
    },
    configuration: { type: agentConfigurationSchema, default: () => ({}) },
    consumer_overrides: [consumerOverrideSchema],
    stripe_subscription_item_id: { type: String },
    installed_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    installed_at: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'agent-installations',
  }
);

agentInstallationSchema.index({ tenant_id: 1, agent_slug: 1 }, { unique: true });
agentInstallationSchema.index({ tenant_id: 1, enabled: 1 });
agentInstallationSchema.index({ agent_slug: 1 });

export const AgentInstallation: Model<AgentInstallationDocument> = mongoose.model<AgentInstallationDocument>(
  'AgentInstallation',
  agentInstallationSchema
);
