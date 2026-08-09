import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IAgentUsage {
  tenant_id: Types.ObjectId;
  agent_slug: string;
  period: string; // 'YYYY-MM'
  executions: number;
  input_tokens: number;
  output_tokens: number;
  actions_executed: number;
  actions_recommended: number;
  approvals_requested: number;
  approvals_approved: number;
  approvals_rejected: number;
  cost_cents: number;
}

export interface AgentUsageDocument extends IAgentUsage, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const agentUsageSchema = new Schema<AgentUsageDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    agent_slug: { type: String, required: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    executions: { type: Number, default: 0 },
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    actions_executed: { type: Number, default: 0 },
    actions_recommended: { type: Number, default: 0 },
    approvals_requested: { type: Number, default: 0 },
    approvals_approved: { type: Number, default: 0 },
    approvals_rejected: { type: Number, default: 0 },
    cost_cents: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'agent-usage',
  }
);

agentUsageSchema.index({ tenant_id: 1, agent_slug: 1, period: 1 }, { unique: true });
agentUsageSchema.index({ tenant_id: 1, period: 1 });

export const AgentUsage: Model<AgentUsageDocument> = mongoose.model<AgentUsageDocument>(
  'AgentUsage',
  agentUsageSchema
);
