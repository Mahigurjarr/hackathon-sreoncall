import mongoose, { Schema, Document, Model, Types } from 'mongoose';

// ─── Step types ───────────────────────────────────────────────────────────────

export type StepType = 'manual' | 'bash_script' | 'api_call' | 'ansible_playbook';

export interface RunbookStep {
  _id: Types.ObjectId;
  order: number;
  title: string;
  instructions: string;
  type: StepType;
  requires_approval: boolean;
  approval_roles: string[];
  timeout_seconds: number;
  // bash_script / ansible fields
  working_directory: string;
  environment_vars: Record<string, string>;
  // api_call fields
  api_method: string;
  api_url: string;
  api_headers: Record<string, string>;
  api_body: string;
  // attachments
  attachments: Array<{ file_id: string; original_name: string; mime_type: string; size_bytes: number }>;
}

export interface RunbookVariable {
  name: string;
  default_value: string;
  description: string;
  required: boolean;
}

export interface RunbookVersionSnapshot {
  version: number;
  title: string;
  description: string;
  steps: RunbookStep[];
  changed_by: Types.ObjectId;
  changed_at: Date;
  change_note: string;
}

export interface RunbookStats {
  executions: number;
  successful: number;
  failed: number;
  avg_duration_seconds: number | null;
  last_executed_at: Date | null;
}

export type RunbookVisibility = 'tenant' | 'provider_shared';

export interface IRunbook {
  tenant_id: Types.ObjectId;
  title: string;
  description: string;
  /**
   * Full markdown body of the runbook — overview, symptoms, triage,
   * diagnosis, mitigation, verification, escalation, post-incident actions,
   * resources. Populated by AI generation and rendered above the structured
   * steps on the runbook detail page.
   */
  content: string;
  category: string;
  status: 'draft' | 'published';
  visibility: RunbookVisibility;
  source_tenant_id?: Types.ObjectId;
  steps: RunbookStep[];
  variables: RunbookVariable[];
  tags: string[];
  service_ids: Types.ObjectId[];
  // author fields — `created_by` is authoritative; `author_id` kept for legacy docs
  created_by: Types.ObjectId;
  author_id: Types.ObjectId | null;
  ai_generated: boolean;
  version: number;
  version_history: RunbookVersionSnapshot[];
  stats: RunbookStats;
}

export interface RunbookDocument extends IRunbook, Document {
  _id: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const stepSchema = new Schema<RunbookStep>(
  {
    order:            { type: Number, required: true, default: 0 },
    title:            { type: String, required: true, trim: true, maxlength: 300 },
    instructions:     { type: String, default: '', maxlength: 50000 },
    type:             { type: String, enum: ['manual', 'bash_script', 'api_call', 'ansible_playbook'], default: 'manual' },
    requires_approval:{ type: Boolean, default: false },
    approval_roles:   [{ type: String }],
    timeout_seconds:  { type: Number, default: 300 },
    working_directory:{ type: String, default: '' },
    environment_vars: { type: Schema.Types.Mixed, default: {} },
    api_method:       { type: String, default: 'GET' },
    api_url:          { type: String, default: '' },
    api_headers:      { type: Schema.Types.Mixed, default: {} },
    api_body:         { type: String, default: '' },
    attachments:      [{ file_id: String, original_name: String, mime_type: String, size_bytes: Number }],
  },
  { _id: true }
);

const variableSchema = new Schema<RunbookVariable>(
  {
    name:          { type: String, required: true },
    default_value: { type: String, default: '' },
    description:   { type: String, default: '' },
    required:      { type: Boolean, default: false },
  },
  { _id: false }
);

const versionSnapshotSchema = new Schema<RunbookVersionSnapshot>(
  {
    version:    { type: Number, required: true },
    title:      { type: String, required: true },
    description:{ type: String, default: '' },
    steps:      [stepSchema],
    changed_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    changed_at: { type: Date, default: () => new Date() },
    change_note:{ type: String, default: '' },
  },
  { _id: false }
);

const statsSchema = new Schema<RunbookStats>(
  {
    executions:           { type: Number, default: 0 },
    successful:           { type: Number, default: 0 },
    failed:               { type: Number, default: 0 },
    avg_duration_seconds: { type: Number, default: null },
    last_executed_at:     { type: Date, default: null },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const runbookSchema = new Schema<RunbookDocument>(
  {
    tenant_id:       { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    title:           { type: String, required: true, trim: true, maxlength: 500 },
    description:     { type: String, default: '', maxlength: 2000 },
    content:         { type: String, default: '', maxlength: 200000 },
    category:        { type: String, default: 'general', trim: true },
    status:          { type: String, enum: ['draft', 'published'], default: 'draft' },
    visibility:      { type: String, enum: ['tenant', 'provider_shared'], default: 'tenant' },
    source_tenant_id:{ type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
    steps:           [stepSchema],
    variables:       [variableSchema],
    tags:            [{ type: String, trim: true, maxlength: 100 }],
    service_ids:     [{ type: Schema.Types.ObjectId, ref: 'Service' }],
    created_by:      { type: Schema.Types.ObjectId, ref: 'User', required: false, default: null },
    author_id:       { type: Schema.Types.ObjectId, ref: 'User', default: null },
    ai_generated:    { type: Boolean, default: false },
    version:         { type: Number, default: 1 },
    version_history: { type: [versionSnapshotSchema], default: [] },
    stats:           { type: statsSchema, default: () => ({}) },
  },
  {
    collection: 'runbooks',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

runbookSchema.index({ tenant_id: 1, status: 1 });
runbookSchema.index({ visibility: 1, tenant_id: 1 });
runbookSchema.index({ tenant_id: 1, tags: 1 });
runbookSchema.index({ tenant_id: 1, created_at: -1 });
runbookSchema.index({ tenant_id: 1, title: 'text', description: 'text' });

export const Runbook: Model<RunbookDocument> =
  mongoose.model<RunbookDocument>('Runbook', runbookSchema);
