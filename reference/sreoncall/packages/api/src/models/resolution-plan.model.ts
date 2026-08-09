import mongoose, { Schema, Document, Model, Types } from 'mongoose';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolutionPlanStatus =
  | 'diagnosing'
  | 'steps_generated'
  | 'in_progress'
  | 'validating'
  | 'validated_pass'
  | 'validated_partial'
  | 'validated_fail'
  | 'completed'
  | 'abandoned';

export type StepType =
  | 'manual'
  | 'command'
  | 'rollback'
  | 'restart'
  | 'scale'
  | 'config_change'
  | 'verification'
  | 'custom';

export type StepSource = 'runbook' | 'ai_suggested' | 'similar_incident' | 'engineer_added' | 'compliance';

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type EvidenceType =
  | 'metric_anomaly'
  | 'log_error'
  | 'trace_latency'
  | 'recent_deploy'
  | 'config_change'
  | 'similar_incident'
  | 'dependency_failure';

export type DiagnosisSourceType =
  | 'runbook'
  | 'ai_analysis'
  | 'similar_incident'
  | 'dependency_graph'
  | 'change_correlation';

export type ValidationStatus = 'running' | 'passed' | 'partial' | 'failed';

export type ValidationCheckType =
  | 'health_endpoint'
  | 'metric_threshold'
  | 'synthetic_monitor'
  | 'tenant_e2e'
  | 'dependency_health';

export type ValidationCheckStatus = 'running' | 'passed' | 'failed' | 'skipped';

export interface EvidenceEntry {
  type: EvidenceType;
  description: string;
  data: Record<string, unknown> | null;
}

export interface AlternativeCause {
  description: string;
  confidence_percent: number;
  evidence: Array<{ type: string; description: string }>;
}

export interface DiagnosisSource {
  type: DiagnosisSourceType;
  reference_id: string | null;
  reference_title: string | null;
}

export interface Diagnosis {
  root_cause: string;
  confidence_percent: number;
  confidence_level: ConfidenceLevel;
  evidence: EvidenceEntry[];
  alternative_causes: AlternativeCause[];
  sources_used: DiagnosisSource[];
}

export interface StepSourceReference {
  runbook_id: Types.ObjectId | null;
  runbook_title: string | null;
  incident_id: Types.ObjectId | null;
  incident_number: number | null;
}

export interface ResolutionStep {
  _id: Types.ObjectId;
  order: number;
  title: string;
  description: string;
  type: StepType;
  source: StepSource;
  source_reference: StepSourceReference | null;
  suggested_command: string | null;
  status: StepStatus;
  completed_by: Types.ObjectId | null;
  completed_at: Date | null;
  skipped_reason: string | null;
  notes: string | null;
  duration_seconds: number | null;
  started_at: Date | null;
}

export interface ValidationCheck {
  name: string;
  type: ValidationCheckType;
  target_service_id: Types.ObjectId | null;
  synthetic_check_id: Types.ObjectId | null;
  status: ValidationCheckStatus;
  details: string | null;
  executed_at: Date;
}

export interface ValidationEntry {
  _id: Types.ObjectId;
  iteration: number;
  triggered_at: Date;
  completed_at: Date | null;
  status: ValidationStatus;
  checks: ValidationCheck[];
  ai_analysis_of_failure: string | null;
  additional_steps_suggested: boolean;
}

export interface ResolutionMetrics {
  diagnosis_time_seconds: number | null;
  total_resolution_time_seconds: number | null;
  steps_completed: number;
  steps_skipped: number;
  steps_total: number;
  validation_attempts: number;
  ai_tokens_used: { input: number; output: number };
}

export interface IResolutionPlan {
  tenant_id: Types.ObjectId;
  incident_id: Types.ObjectId;
  status: ResolutionPlanStatus;
  iteration: number;
  diagnosis: Diagnosis;
  steps: ResolutionStep[];
  validations: ValidationEntry[];
  metrics: ResolutionMetrics;
  created_by: Types.ObjectId;
  completed_at: Date | null;
  abandoned_at: Date | null;
  abandoned_reason: string | null;
}

export interface ResolutionPlanDocument extends IResolutionPlan, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const evidenceSchema = new Schema<EvidenceEntry>(
  {
    type: {
      type: String,
      enum: ['metric_anomaly', 'log_error', 'trace_latency', 'recent_deploy',
             'config_change', 'similar_incident', 'dependency_failure'],
      required: true,
    },
    description: { type: String, required: true },
    data:        { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const alternativeCauseEvidenceSchema = new Schema(
  {
    type:        { type: String, required: true },
    description: { type: String, required: true },
  },
  { _id: false }
);

const alternativeCauseSchema = new Schema<AlternativeCause>(
  {
    description:         { type: String, required: true },
    confidence_percent:  { type: Number, required: true },
    evidence:            [alternativeCauseEvidenceSchema],
  },
  { _id: false }
);

const diagnosisSourceSchema = new Schema<DiagnosisSource>(
  {
    type: {
      type: String,
      enum: ['runbook', 'ai_analysis', 'similar_incident', 'dependency_graph', 'change_correlation'],
      required: true,
    },
    reference_id:    { type: String, default: null },
    reference_title: { type: String, default: null },
  },
  { _id: false }
);

const diagnosisSchema = new Schema<Diagnosis>(
  {
    root_cause:          { type: String, required: true },
    confidence_percent:  { type: Number, required: true, min: 0, max: 100 },
    confidence_level:    {
      type: String,
      enum: ['high', 'medium', 'low'],
      required: true,
    },
    evidence:            [evidenceSchema],
    alternative_causes:  [alternativeCauseSchema],
    sources_used:        [diagnosisSourceSchema],
  },
  { _id: false }
);

const sourceReferenceSchema = new Schema<StepSourceReference>(
  {
    runbook_id:      { type: Schema.Types.ObjectId, ref: 'Runbook', default: null },
    runbook_title:   { type: String, default: null },
    incident_id:     { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    incident_number: { type: Number, default: null },
  },
  { _id: false }
);

const stepSchema = new Schema<ResolutionStep>(
  {
    order:             { type: Number, required: true },
    title:             { type: String, required: true },
    description:       { type: String, default: '' },
    type:              {
      type: String,
      enum: ['manual', 'command', 'rollback', 'restart', 'scale', 'config_change', 'verification', 'custom'],
      required: true,
    },
    source:            {
      type: String,
      enum: ['runbook', 'ai_suggested', 'similar_incident', 'engineer_added', 'compliance'],
      required: true,
    },
    source_reference:  { type: sourceReferenceSchema, default: null },
    suggested_command: { type: String, default: null },
    status:            {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'skipped', 'failed'],
      default: 'pending',
    },
    completed_by:      { type: Schema.Types.ObjectId, ref: 'User', default: null },
    completed_at:      { type: Date, default: null },
    skipped_reason:    { type: String, default: null },
    notes:             { type: String, default: null },
    duration_seconds:  { type: Number, default: null },
    started_at:        { type: Date, default: null },
  },
  { _id: true }
);

const validationCheckSchema = new Schema<ValidationCheck>(
  {
    name:               { type: String, required: true },
    type:               {
      type: String,
      enum: ['health_endpoint', 'metric_threshold', 'synthetic_monitor', 'tenant_e2e', 'dependency_health'],
      required: true,
    },
    target_service_id:  { type: Schema.Types.ObjectId, ref: 'Service', default: null },
    synthetic_check_id: { type: Schema.Types.ObjectId, ref: 'SyntheticCheck', default: null },
    status:             {
      type: String,
      enum: ['running', 'passed', 'failed', 'skipped'],
      default: 'running',
    },
    details:            { type: String, default: null },
    executed_at:        { type: Date, required: true },
  },
  { _id: false }
);

const validationSchema = new Schema<ValidationEntry>(
  {
    iteration:                  { type: Number, required: true },
    triggered_at:               { type: Date, required: true },
    completed_at:               { type: Date, default: null },
    status:                     {
      type: String,
      enum: ['running', 'passed', 'partial', 'failed'],
      default: 'running',
    },
    checks:                     [validationCheckSchema],
    ai_analysis_of_failure:     { type: String, default: null },
    additional_steps_suggested: { type: Boolean, default: false },
  },
  { _id: true }
);

const metricsSchema = new Schema<ResolutionMetrics>(
  {
    diagnosis_time_seconds:       { type: Number, default: null },
    total_resolution_time_seconds:{ type: Number, default: null },
    steps_completed:              { type: Number, default: 0 },
    steps_skipped:                { type: Number, default: 0 },
    steps_total:                  { type: Number, default: 0 },
    validation_attempts:          { type: Number, default: 0 },
    ai_tokens_used:               {
      input:  { type: Number, default: 0 },
      output: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const resolutionPlanSchema = new Schema<ResolutionPlanDocument>(
  {
    tenant_id:        { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    incident_id:      { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    status:           {
      type: String,
      enum: [
        'diagnosing', 'steps_generated', 'in_progress', 'validating',
        'validated_pass', 'validated_partial', 'validated_fail',
        'completed', 'abandoned',
      ],
      default: 'diagnosing',
    },
    iteration:        { type: Number, default: 1 },
    diagnosis:        { type: diagnosisSchema, default: () => ({}) },
    steps:            [stepSchema],
    validations:      [validationSchema],
    metrics:          { type: metricsSchema, default: () => ({}) },
    created_by:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    completed_at:     { type: Date, default: null },
    abandoned_at:     { type: Date, default: null },
    abandoned_reason: { type: String, default: null },
  },
  {
    collection: 'resolution_plans',
    timestamps: true,
  }
);

resolutionPlanSchema.index({ tenant_id: 1, incident_id: 1 });
resolutionPlanSchema.index({ tenant_id: 1, status: 1 });
resolutionPlanSchema.index({ tenant_id: 1, createdAt: -1 });

export const ResolutionPlan: Model<ResolutionPlanDocument> =
  mongoose.model<ResolutionPlanDocument>('ResolutionPlan', resolutionPlanSchema);
