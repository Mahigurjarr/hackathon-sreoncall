import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type AgentCategory =
  | 'incident_response'
  | 'observability'
  | 'change_management'
  | 'automation'
  | 'communication'
  | 'reliability'
  | 'people'
  | 'knowledge'
  | 'managed_services'
  | 'governance';

export type AgentTenantRestriction = 'any' | 'provider' | 'standalone' | 'consumer';

export interface AgentLLMConfig {
  primary_model: string;
  fallback_model: string;
  max_tokens: number;
  temperature: number;
}

export interface AgentPricing {
  monthly_cents: number;
  stripe_price_id?: string;
}

export interface IAgentDefinition {
  slug: string;
  display_name: string;
  description: string;
  long_description: string;
  category: AgentCategory;
  version: string;
  icon: string;
  capabilities: string[];
  triggers: string[];
  required_scopes: string[];
  required_plan: 'starter' | 'business' | 'enterprise';
  tenant_type_restriction: AgentTenantRestriction;
  llm_config: AgentLLMConfig;
  pricing: AgentPricing;
  is_active: boolean;
  is_beta: boolean;
  sort_order: number;
}

export interface AgentDefinitionDocument extends IAgentDefinition, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const llmConfigSchema = new Schema<AgentLLMConfig>(
  {
    primary_model: { type: String, default: 'gpt-4o' },
    fallback_model: { type: String, default: 'gpt-4o-mini' },
    max_tokens: { type: Number, default: 4096 },
    temperature: { type: Number, default: 0.3 },
  },
  { _id: false }
);

const pricingSchema = new Schema<AgentPricing>(
  {
    monthly_cents: { type: Number, default: 0, min: 0 },
    stripe_price_id: { type: String },
  },
  { _id: false }
);

const agentDefinitionSchema = new Schema<AgentDefinitionDocument>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 100,
    },
    display_name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, maxlength: 500 },
    long_description: { type: String, default: '', maxlength: 5000 },
    category: {
      type: String,
      enum: [
        'incident_response', 'observability', 'change_management',
        'automation', 'communication', 'reliability', 'people',
        'knowledge', 'managed_services', 'governance',
      ],
      required: true,
    },
    version: { type: String, default: '1.0.0' },
    icon: { type: String, default: 'Bot' },
    capabilities: [{ type: String, trim: true }],
    triggers: [{ type: String, trim: true }],
    required_scopes: [{ type: String, trim: true }],
    required_plan: {
      type: String,
      enum: ['starter', 'business', 'enterprise'],
      default: 'business',
    },
    tenant_type_restriction: {
      type: String,
      enum: ['any', 'provider', 'standalone', 'consumer'],
      default: 'any',
    },
    llm_config: { type: llmConfigSchema, default: () => ({}) },
    pricing: { type: pricingSchema, default: () => ({}) },
    is_active: { type: Boolean, default: true },
    is_beta: { type: Boolean, default: false },
    sort_order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'agent-definitions',
  }
);

agentDefinitionSchema.index({ category: 1, sort_order: 1 });
agentDefinitionSchema.index({ is_active: 1 });

export const AgentDefinition: Model<AgentDefinitionDocument> = mongoose.model<AgentDefinitionDocument>(
  'AgentDefinition',
  agentDefinitionSchema
);
