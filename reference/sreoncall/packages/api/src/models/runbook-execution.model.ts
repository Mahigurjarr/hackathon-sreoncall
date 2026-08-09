import mongoose, { Schema, Document, Model, Types } from 'mongoose';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecutionStatus =
  | 'running'
  | 'paused_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepExecutionStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface ExecutionStepState {
  _id: Types.ObjectId;
  step_id: string;
  order: number;
  title: string;
  type: string;
  requires_approval: boolean;
  instructions: string;
  status: StepExecutionStatus;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number | null;
  output: string;
  error: string | null;
  approved_by: Types.ObjectId | null;
  approved_at: Date | null;
  approval_comment: string | null;
}

export interface ExecutionLogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface IRunbookExecution {
  tenant_id: Types.ObjectId;
  runbook_id: Types.ObjectId;
  runbook_version: number;
  runbook_title: string;
  status: ExecutionStatus;
  triggered_by: Types.ObjectId;
  triggered_by_incident_id: Types.ObjectId | null;
  current_step: number;
  steps_state: ExecutionStepState[];
  variables: Record<string, string>;
  started_at: Date;
  completed_at: Date | null;
  duration_ms: number | null;
  output_log: ExecutionLogEntry[];
}

export interface RunbookExecutionDocument extends IRunbookExecution, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const stepStateSchema = new Schema<ExecutionStepState>(
  {
    step_id:          { type: String, required: true },
    order:            { type: Number, required: true },
    title:            { type: String, required: true },
    type:             { type: String, required: true },
    requires_approval:{ type: Boolean, default: false },
    instructions:     { type: String, default: '' },
    status:           {
      type: String,
      enum: ['pending', 'awaiting_approval', 'running', 'completed', 'failed', 'skipped'],
      default: 'pending',
    },
    started_at:       { type: Date, default: null },
    completed_at:     { type: Date, default: null },
    duration_ms:      { type: Number, default: null },
    output:           { type: String, default: '' },
    error:            { type: String, default: null },
    approved_by:      { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approved_at:      { type: Date, default: null },
    approval_comment: { type: String, default: null },
  },
  { _id: true }
);

const logEntrySchema = new Schema<ExecutionLogEntry>(
  {
    timestamp: { type: Date, default: () => new Date() },
    level:     { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    message:   { type: String, required: true },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const runbookExecutionSchema = new Schema<RunbookExecutionDocument>(
  {
    tenant_id:               { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    runbook_id:              { type: Schema.Types.ObjectId, ref: 'Runbook', required: true, index: true },
    runbook_version:         { type: Number, required: true, default: 1 },
    runbook_title:           { type: String, required: true },
    status:                  {
      type: String,
      enum: ['running', 'paused_approval', 'completed', 'failed', 'cancelled'],
      default: 'running',
    },
    triggered_by:            { type: Schema.Types.ObjectId, ref: 'User', required: true },
    triggered_by_incident_id:{ type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    current_step:            { type: Number, default: 0 },
    steps_state:             [stepStateSchema],
    variables:               { type: Schema.Types.Mixed, default: {} },
    started_at:              { type: Date, default: () => new Date() },
    completed_at:            { type: Date, default: null },
    duration_ms:             { type: Number, default: null },
    output_log:              [logEntrySchema],
  },
  {
    collection: 'runbook_executions',
    timestamps: true,
  }
);

runbookExecutionSchema.index({ tenant_id: 1, runbook_id: 1, createdAt: -1 });
runbookExecutionSchema.index({ tenant_id: 1, status: 1 });
runbookExecutionSchema.index({ tenant_id: 1, createdAt: -1 });

export const RunbookExecution: Model<RunbookExecutionDocument> =
  mongoose.model<RunbookExecutionDocument>('RunbookExecution', runbookExecutionSchema);
