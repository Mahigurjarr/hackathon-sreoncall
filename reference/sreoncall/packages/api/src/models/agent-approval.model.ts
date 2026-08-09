import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_expired';
export type ApprovalPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ApprovalAction {
  action_type: string;
  description: string;
  target_id?: string;
  target_type?: string;
  risk_level: string;
  reasoning: string;
  context?: any;
}

export interface IAgentApproval {
  tenant_id: Types.ObjectId;
  consumer_tenant_id?: Types.ObjectId;
  execution_id: Types.ObjectId;
  agent_slug: string;
  action: ApprovalAction;
  status: ApprovalStatus;
  priority: ApprovalPriority;
  requested_at: Date;
  expires_at: Date;
  decided_by?: Types.ObjectId;
  decided_at?: Date;
  decision_reason?: string;
}

export interface AgentApprovalDocument extends IAgentApproval, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const approvalActionSchema = new Schema<ApprovalAction>(
  {
    action_type: { type: String, required: true },
    description: { type: String, required: true },
    target_id: { type: String },
    target_type: { type: String },
    risk_level: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
    reasoning: { type: String, required: true },
    context: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const agentApprovalSchema = new Schema<AgentApprovalDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant' },
    execution_id: { type: Schema.Types.ObjectId, ref: 'AgentExecution', required: true },
    agent_slug: { type: String, required: true },
    action: { type: approvalActionSchema, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired', 'auto_expired'],
      default: 'pending',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    requested_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true },
    decided_by: { type: Schema.Types.ObjectId, ref: 'User' },
    decided_at: { type: Date },
    decision_reason: { type: String, maxlength: 1000 },
  },
  {
    timestamps: true,
    collection: 'agent-approvals',
  }
);

agentApprovalSchema.index({ tenant_id: 1, status: 1, priority: -1, requested_at: -1 });
agentApprovalSchema.index({ execution_id: 1 });
agentApprovalSchema.index({ expires_at: 1 });

export const AgentApproval: Model<AgentApprovalDocument> = mongoose.model<AgentApprovalDocument>(
  'AgentApproval',
  agentApprovalSchema
);
