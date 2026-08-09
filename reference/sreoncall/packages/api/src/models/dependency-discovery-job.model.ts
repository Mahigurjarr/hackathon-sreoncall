import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface DiscoverySource {
  document_file_id: Types.ObjectId | null;
  document_filename: string | null;
  scan_window_hours: number | null;
  observability_connection_id: Types.ObjectId | null;
}

export interface DiscoveryResults {
  edges_discovered: number;
  edges_new: number;
  edges_updated: number;
  edges_stale: number;
  services_discovered: number;
  processing_time_ms: number;
}

export interface IDependencyDiscoveryJob {
  tenant_id: Types.ObjectId;
  type: 'otel_trace_scan' | 'document_upload' | 'network_scan';
  status: 'pending' | 'running' | 'completed' | 'failed';
  source: DiscoverySource;
  results: DiscoveryResults | null;
  ai_parse_output: string | null;
  error_message: string | null;
  triggered_by: Types.ObjectId | null;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface DependencyDiscoveryJobDocument extends IDependencyDiscoveryJob, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const discoverySourceSchema = new Schema<DiscoverySource>(
  {
    document_file_id: { type: Schema.Types.ObjectId, default: null },
    document_filename: { type: String, default: null },
    scan_window_hours: { type: Number, default: null },
    observability_connection_id: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false }
);

const discoveryResultsSchema = new Schema<DiscoveryResults>(
  {
    edges_discovered: { type: Number, required: true },
    edges_new: { type: Number, required: true },
    edges_updated: { type: Number, required: true },
    edges_stale: { type: Number, required: true },
    services_discovered: { type: Number, required: true },
    processing_time_ms: { type: Number, required: true },
  },
  { _id: false }
);

const dependencyDiscoveryJobSchema = new Schema<DependencyDiscoveryJobDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    type: {
      type: String,
      enum: ['otel_trace_scan', 'document_upload', 'network_scan'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    source: { type: discoverySourceSchema, default: () => ({}) },
    results: { type: discoveryResultsSchema, default: null },
    ai_parse_output: { type: String, default: null },
    error_message: { type: String, default: null },
    // null = scheduler-triggered (no human actor) — see dependency-discovery-scheduler.worker.ts
    triggered_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'dependency_discovery_jobs',
  }
);

dependencyDiscoveryJobSchema.index({ tenant_id: 1, status: 1 });
dependencyDiscoveryJobSchema.index({ tenant_id: 1, createdAt: -1 });
dependencyDiscoveryJobSchema.index({ tenant_id: 1, type: 1, createdAt: -1 });

export const DependencyDiscoveryJob: Model<DependencyDiscoveryJobDocument> = mongoose.model<DependencyDiscoveryJobDocument>(
  'DependencyDiscoveryJob',
  dependencyDiscoveryJobSchema
);
