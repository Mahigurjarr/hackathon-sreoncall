import mongoose, { Schema, Document, Model, Types } from 'mongoose';

// ─── Sub-document types ───────────────────────────────────────────────────────

export type ChangeType   = 'standard' | 'normal' | 'emergency';
export type ChangeStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'rolled_back'
  | 'cancelled'
  | 'not_approved_by_cab'
  | 'implemented';

export type RiskScore = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalDecision = 'approved' | 'rejected' | 'abstained';
export type PirStatus  = 'pending' | 'completed' | 'waived';
export type PirOutcome = 'successful' | 'partial_success' | 'failed' | 'rolled_back';

export interface ApprovalDecisionEntry {
  user_id: Types.ObjectId;
  decision: ApprovalDecision;
  comment: string;
  decided_at: Date;
}

export interface ApprovalStep {
  _id: Types.ObjectId;
  step: number;                       // 1-based step order
  type: 'sequential' | 'parallel';
  required_approvals: number;         // How many approvals needed in this step
  approvers: Array<{ user_id: Types.ObjectId; role: string | null; external: boolean; external_email: string | null }>;
  decisions: ApprovalDecisionEntry[];
  completed_at: Date | null;          // null = step still open
}

export interface ImplementationWindow {
  start: Date;
  end: Date;
  timezone: string;
}

export interface AiWindowSuggestion {
  start: Date;
  end: Date;
  reason: string;
}

export interface Pir {
  status: PirStatus;
  outcome: PirOutcome | null;
  notes: string | null;
  reviewed_by: Types.ObjectId | null;
  reviewed_at: Date | null;
}

// ─── Main interface ───────────────────────────────────────────────────────────

export interface IChangeRequest {
  tenant_id: Types.ObjectId;
  number: number;                     // CR-{number}
  type: ChangeType;
  title: string;
  description: string;
  justification: string;
  rollback_plan: string;

  risk: {
    score: RiskScore;
    ai_score: RiskScore | null;
    factors: string[];
    blast_radius_description: string;
  };

  affected_service_ids: Types.ObjectId[];
  implementation_window: ImplementationWindow | null;

  status: ChangeStatus;
  approval_chain: ApprovalStep[];
  current_step: number;              // which step is active (1-based, 0 = none)

  pir: Pir | null;

  // AI fields
  ai_conflict_warnings: string[];
  ai_window_suggestions: AiWindowSuggestion[];
  freeze_window_conflict: boolean;

  // Linking
  linked_ticket_ids: Types.ObjectId[];
  linked_runbook_ids: Types.ObjectId[];
  linked_incident_ids: Types.ObjectId[];

  labels: string[];
  custom_fields: Record<string, unknown>;
  created_by: Types.ObjectId;
  requester_id: Types.ObjectId | null;
  change_owner_id: Types.ObjectId | null;
  roll_out_date: Date | null;
  notes: Array<{ user_id: Types.ObjectId; body: string; type: 'comment' | 'state_change' | 'discussion'; created_at: Date }>;

  scheduled_at: Date | null;
  implemented_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
}

export interface ChangeRequestDocument extends IChangeRequest, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

const approvalDecisionSchema = new Schema<ApprovalDecisionEntry>(
  {
    user_id:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    decision:   { type: String, enum: ['approved', 'rejected', 'abstained'], required: true },
    comment:    { type: String, default: '' },
    decided_at: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const approvalStepSchema = new Schema<ApprovalStep>(
  {
    step:               { type: Number, required: true },
    type:               { type: String, enum: ['sequential', 'parallel'], default: 'sequential' },
    required_approvals: { type: Number, default: 1 },
    approvers: [
      {
        user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role:    { type: String, default: null },
        external: { type: Boolean, default: false },
        external_email: { type: String, default: null },
        _id: false,
      },
    ],
    decisions:    [approvalDecisionSchema],
    completed_at: { type: Date, default: null },
  },
  { _id: true }
);

const windowSchema = new Schema<ImplementationWindow>(
  {
    start:    { type: Date, required: true },
    end:      { type: Date, required: true },
    timezone: { type: String, default: 'UTC' },
  },
  { _id: false }
);

const suggestionSchema = new Schema<AiWindowSuggestion>(
  {
    start:  { type: Date, required: true },
    end:    { type: Date, required: true },
    reason: { type: String, default: '' },
  },
  { _id: false }
);

const pirSchema = new Schema<Pir>(
  {
    status:      { type: String, enum: ['pending', 'completed', 'waived'], default: 'pending' },
    outcome:     { type: String, enum: ['successful', 'partial_success', 'failed', 'rolled_back'], default: null },
    notes:       { type: String, default: null },
    reviewed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewed_at: { type: Date, default: null },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const changeRequestSchema = new Schema<ChangeRequestDocument>(
  {
    tenant_id:   { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    number:      { type: Number, required: true },
    type:        { type: String, enum: ['standard', 'normal', 'emergency'], default: 'normal' },
    title:       { type: String, required: true, trim: true, maxlength: 500 },
    description: { type: String, default: '', maxlength: 100000 },
    justification: { type: String, default: '', maxlength: 10000 },
    rollback_plan: { type: String, default: '', maxlength: 10000 },

    risk: {
      score:                   { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
      ai_score:                { type: String, enum: ['low', 'medium', 'high', 'critical', null], default: null },
      factors:                 [{ type: String }],
      blast_radius_description: { type: String, default: '' },
    },

    affected_service_ids:    [{ type: Schema.Types.ObjectId, ref: 'Service' }],
    implementation_window:   { type: windowSchema, default: null },

    status: {
      type: String,
      enum: ['draft', 'submitted', 'pending_approval', 'approved', 'rejected',
             'scheduled', 'in_progress', 'completed', 'rolled_back', 'cancelled',
             'not_approved_by_cab', 'implemented'],
      default: 'draft',
    },

    approval_chain: [approvalStepSchema],
    current_step:   { type: Number, default: 0 },

    pir: { type: pirSchema, default: null },

    ai_conflict_warnings: [{ type: String }],
    ai_window_suggestions: [suggestionSchema],
    freeze_window_conflict: { type: Boolean, default: false },

    linked_ticket_ids:   [{ type: Schema.Types.ObjectId, ref: 'Ticket' }],
    linked_runbook_ids:  [{ type: Schema.Types.ObjectId, ref: 'Runbook' }],
    linked_incident_ids: [{ type: Schema.Types.ObjectId, ref: 'Incident' }],

    labels:        [{ type: String, trim: true }],
    custom_fields: { type: Schema.Types.Mixed, default: {} },
    created_by:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requester_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    change_owner_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    roll_out_date: { type: Date, default: null },
    notes: [{
      user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      body: { type: String, required: true },
      type: { type: String, enum: ['comment', 'state_change', 'discussion'], default: 'comment' },
      created_at: { type: Date, default: () => new Date() },
      _id: false,
    }],

    scheduled_at:   { type: Date, default: null },
    implemented_at: { type: Date, default: null },
    completed_at:   { type: Date, default: null },
    cancelled_at:   { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'change_requests',
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

changeRequestSchema.index({ tenant_id: 1, status: 1 });
changeRequestSchema.index({ tenant_id: 1, number: 1 }, { unique: true });
changeRequestSchema.index({ tenant_id: 1, createdAt: -1 });
changeRequestSchema.index({ tenant_id: 1, type: 1 });
changeRequestSchema.index({ 'implementation_window.start': 1, 'implementation_window.end': 1 });

export const ChangeRequest: Model<ChangeRequestDocument> = mongoose.model<ChangeRequestDocument>(
  'ChangeRequest',
  changeRequestSchema
);
