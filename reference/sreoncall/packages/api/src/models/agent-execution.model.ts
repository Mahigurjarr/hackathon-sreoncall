import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_approval';
export type TriggerType = 'event' | 'schedule' | 'manual' | 'agent';
export type ActionRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ActionStatus = 'executed' | 'approved' | 'rejected' | 'pending_approval' | 'skipped';

export interface ExecutionTrigger {
  type: TriggerType;
  event_type?: string;
  source_id?: string;
  parent_execution_id?: Types.ObjectId;
}

export interface ExecutionAction {
  action_type: string;
  description: string;
  target_id?: string;
  target_type?: string;
  risk_level: ActionRiskLevel;
  status: ActionStatus;
  result?: any;
  executed_at?: Date;
}

export interface ExecutionRecommendation {
  action_type: string;
  description: string;
  reasoning: string;
  risk_level: ActionRiskLevel;
}

export interface ExecutionOutcome {
  summary: string;
  success: boolean;
  error_message?: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export interface IAgentExecution {
  tenant_id: Types.ObjectId;
  consumer_tenant_id?: Types.ObjectId;
  agent_slug: string;
  installation_id: Types.ObjectId;
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  context_summary: string;
  reasoning: string;
  actions_taken: ExecutionAction[];
  recommendations: ExecutionRecommendation[];
  outcome?: ExecutionOutcome;
  token_usage?: TokenUsage;
  cost_cents: number;
  duration_ms: number;
  started_at: Date;
  completed_at?: Date;
}

export interface AgentExecutionDocument extends IAgentExecution, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const triggerSchema = new Schema<ExecutionTrigger>(
  {
    type: { type: String, enum: ['event', 'schedule', 'manual', 'agent'], required: true },
    event_type: { type: String },
    source_id: { type: String },
    parent_execution_id: { type: Schema.Types.ObjectId, ref: 'AgentExecution' },
  },
  { _id: false }
);

const actionSchema = new Schema<ExecutionAction>(
  {
    action_type: { type: String, required: true },
    description: { type: String, required: true },
    target_id: { type: String },
    target_type: { type: String },
    risk_level: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
    status: {
      type: String,
      enum: ['executed', 'approved', 'rejected', 'pending_approval', 'skipped'],
      required: true,
    },
    result: { type: Schema.Types.Mixed },
    executed_at: { type: Date },
  },
  { _id: false }
);

const recommendationSchema = new Schema<ExecutionRecommendation>(
  {
    action_type: { type: String, required: true },
    description: { type: String, required: true },
    reasoning: { type: String, required: true },
    risk_level: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
  },
  { _id: false }
);

const outcomeSchema = new Schema<ExecutionOutcome>(
  {
    summary: { type: String, required: true },
    success: { type: Boolean, required: true },
    error_message: { type: String },
  },
  { _id: false }
);

const tokenUsageSchema = new Schema<TokenUsage>(
  {
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    model: { type: String, required: true },
  },
  { _id: false }
);

const agentExecutionSchema = new Schema<AgentExecutionDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    agent_slug: { type: String, required: true },
    installation_id: { type: Schema.Types.ObjectId, ref: 'AgentInstallation', required: true },
    trigger: { type: triggerSchema, required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'cancelled', 'awaiting_approval'],
      default: 'running',
    },
    context_summary: { type: String, default: '' },
    reasoning: { type: String, default: '' },
    actions_taken: [actionSchema],
    recommendations: [recommendationSchema],
    outcome: { type: outcomeSchema },
    token_usage: { type: tokenUsageSchema },
    cost_cents: { type: Number, default: 0 },
    duration_ms: { type: Number, default: 0 },
    started_at: { type: Date, default: Date.now },
    completed_at: { type: Date },
  },
  {
    timestamps: true,
    collection: 'agent-executions',
  }
);

agentExecutionSchema.index({ tenant_id: 1, started_at: -1 });
agentExecutionSchema.index({ tenant_id: 1, agent_slug: 1, started_at: -1 });
agentExecutionSchema.index({ consumer_tenant_id: 1, started_at: -1 });
agentExecutionSchema.index({ status: 1 });
// 90-day retention
agentExecutionSchema.index({ started_at: 1 }, { expireAfterSeconds: 7_776_000 });

export const AgentExecution: Model<AgentExecutionDocument> = mongoose.model<AgentExecutionDocument>(
  'AgentExecution',
  agentExecutionSchema
);
