import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface CorrelationEvidence {
  type: 'dependency_graph' | 'temporal_proximity' | 'shared_deployment' | 'common_error_pattern' | 'shared_upstream' | 'historical_pattern' | 'shared_correlation_group';
  description: string;
  weight: number;
}

export interface IIncidentCorrelation {
  tenant_id: Types.ObjectId;
  parent_incident_id: Types.ObjectId | null;
  correlated_incident_ids: Types.ObjectId[];
  status: 'proposed' | 'confirmed' | 'rejected';
  correlation_type: 'dependency_chain' | 'shared_root_cause' | 'cascading_failure' | 'common_change' | 'temporal';
  confidence_percent: number;
  evidence: CorrelationEvidence[];
  confirmed_by: Types.ObjectId | null;
  confirmed_at: Date | null;
  rejected_by: Types.ObjectId | null;
  rejected_reason: string | null;
}

export interface IncidentCorrelationDocument extends IIncidentCorrelation, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const evidenceSchema = new Schema<CorrelationEvidence>(
  {
    type: {
      type: String,
      enum: ['dependency_graph', 'temporal_proximity', 'shared_deployment', 'common_error_pattern', 'shared_upstream', 'historical_pattern', 'shared_correlation_group'],
      required: true,
    },
    description: { type: String, required: true },
    weight: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const incidentCorrelationSchema = new Schema<IncidentCorrelationDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    parent_incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
    correlated_incident_ids: [{ type: Schema.Types.ObjectId, ref: 'Incident' }],
    status: {
      type: String,
      enum: ['proposed', 'confirmed', 'rejected'],
      default: 'proposed',
    },
    correlation_type: {
      type: String,
      enum: ['dependency_chain', 'shared_root_cause', 'cascading_failure', 'common_change', 'temporal'],
      required: true,
    },
    confidence_percent: { type: Number, required: true, min: 0, max: 100 },
    evidence: [evidenceSchema],
    confirmed_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    confirmed_at: { type: Date, default: null },
    rejected_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejected_reason: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'incident_correlations',
  }
);

incidentCorrelationSchema.index({ tenant_id: 1, status: 1 });
incidentCorrelationSchema.index({ tenant_id: 1, correlated_incident_ids: 1 });
incidentCorrelationSchema.index({ tenant_id: 1, createdAt: -1 });

export const IncidentCorrelation: Model<IncidentCorrelationDocument> = mongoose.model<IncidentCorrelationDocument>(
  'IncidentCorrelation',
  incidentCorrelationSchema
);
