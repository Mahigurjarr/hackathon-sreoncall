import mongoose, { Schema, Document, Model, Types } from 'mongoose';

/**
 * The single reviewable-action primitive for anything an MCP tool "proposes"
 * rather than writes directly: a tool call captures its intent here instead
 * of calling the real creation service, a human reviews the plain-language
 * summary in-app, and only an explicit approve calls the real service with
 * the stored payload. Reject/expire never touch production data at all.
 *
 * One model for every proposable action type (ticket, change request, ...)
 * rather than a bespoke pending-state per feature — new proposal types are
 * new `target_type` values plus one switch-case in mcp-proposal.service.ts's
 * apply step, not a new schema.
 */
export type McpProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'apply_failed';
export type McpProposalTargetType = 'ticket' | 'change_request' | 'runbook' | 'alert_rule' | 'oncall_override';

export interface IMcpProposal {
  tenant_id: Types.ObjectId;
  created_by_api_key_id: Types.ObjectId;
  tool_name: string;
  target_type: McpProposalTargetType;
  /** Plain-language description of what will happen if approved — shown to the reviewer, not the raw payload. */
  summary: string;
  /** The exact input the target service will be called with on approval. */
  payload: Record<string, unknown>;
  status: McpProposalStatus;
  /** Set once status moves to 'applied' — the resulting entity's id. */
  applied_entity_id: Types.ObjectId | null;
  apply_error: string | null;
  reviewed_by: Types.ObjectId | null;
  reviewed_at: Date | null;
}

export interface McpProposalDocument extends IMcpProposal, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const mcpProposalSchema = new Schema<McpProposalDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    created_by_api_key_id: { type: Schema.Types.ObjectId, ref: 'ApiKey', required: true },
    tool_name: { type: String, required: true },
    target_type: { type: String, enum: ['ticket', 'change_request', 'runbook', 'alert_rule', 'oncall_override'], required: true },
    summary: { type: String, required: true, maxlength: 2000 },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'applied', 'apply_failed'],
      default: 'pending',
    },
    applied_entity_id: { type: Schema.Types.ObjectId, default: null },
    apply_error: { type: String, default: null },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewed_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'mcp_proposals',
  },
);

mcpProposalSchema.index({ tenant_id: 1, status: 1, createdAt: -1 });

export const McpProposal: Model<McpProposalDocument> = mongoose.model<McpProposalDocument>(
  'McpProposal',
  mcpProposalSchema,
);
