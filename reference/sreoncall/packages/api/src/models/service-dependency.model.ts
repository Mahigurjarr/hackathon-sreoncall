import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface ProtocolDetails {
  port: number | null;
  path: string | null;
  method: string | null;
  queue_name: string | null;
  topic: string | null;
  database_name: string | null;
  collection_name: string | null;
}

export interface TrafficMetadata {
  avg_requests_per_minute: number | null;
  avg_latency_ms: number | null;
  error_rate_percent: number | null;
  last_updated_at: Date | null;
}

export interface IServiceDependency {
  tenant_id: Types.ObjectId;
  source_service_id: Types.ObjectId;
  target_service_id: Types.ObjectId;
  dependency_type: 'http' | 'grpc' | 'tcp' | 'database' | 'queue' | 'cache' | 'dns' | 'file' | 'custom';
  protocol_details: ProtocolDetails;
  criticality: 'critical' | 'high' | 'medium' | 'low';
  discovery_method: 'auto_otel' | 'auto_network' | 'manual' | 'document_upload' | 'ai_parsed';
  status: 'proposed' | 'approved' | 'rejected' | 'archived';
  approved_by: Types.ObjectId | null;
  approved_at: Date | null;
  rejected_reason: string | null;
  last_seen_at: Date | null;
  first_seen_at: Date | null;
  traffic_metadata: TrafficMetadata;
  labels: Map<string, string>;
  notes: string | null;
  created_by: Types.ObjectId | null;
  version: number;
  observation_count: number;
  auto_approved: boolean;
}

export interface ServiceDependencyDocument extends IServiceDependency, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const protocolDetailsSchema = new Schema<ProtocolDetails>(
  {
    port: { type: Number, default: null },
    path: { type: String, default: null },
    method: { type: String, default: null },
    queue_name: { type: String, default: null },
    topic: { type: String, default: null },
    database_name: { type: String, default: null },
    collection_name: { type: String, default: null },
  },
  { _id: false }
);

const trafficMetadataSchema = new Schema<TrafficMetadata>(
  {
    avg_requests_per_minute: { type: Number, default: null },
    avg_latency_ms: { type: Number, default: null },
    error_rate_percent: { type: Number, default: null },
    last_updated_at: { type: Date, default: null },
  },
  { _id: false }
);

const serviceDependencySchema = new Schema<ServiceDependencyDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    source_service_id: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    target_service_id: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    dependency_type: {
      type: String,
      enum: ['http', 'grpc', 'tcp', 'database', 'queue', 'cache', 'dns', 'file', 'custom'],
      required: true,
    },
    protocol_details: { type: protocolDetailsSchema, default: () => ({}) },
    criticality: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium',
    },
    discovery_method: {
      type: String,
      enum: ['auto_otel', 'auto_network', 'manual', 'document_upload', 'ai_parsed'],
      required: true,
    },
    status: {
      type: String,
      enum: ['proposed', 'approved', 'rejected', 'archived'],
      default: 'proposed',
    },
    approved_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approved_at: { type: Date, default: null },
    rejected_reason: { type: String, default: null },
    last_seen_at: { type: Date, default: null },
    first_seen_at: { type: Date, default: null },
    traffic_metadata: { type: trafficMetadataSchema, default: () => ({}) },
    labels: { type: Map, of: String, default: () => new Map() },
    notes: { type: String, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    version: { type: Number, default: 1 },
    observation_count: { type: Number, default: 1, min: 0 },
    auto_approved: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'service_dependencies',
  }
);

serviceDependencySchema.index(
  { tenant_id: 1, source_service_id: 1, target_service_id: 1 },
  { unique: true }
);
serviceDependencySchema.index({ tenant_id: 1, status: 1 });
serviceDependencySchema.index({ tenant_id: 1, discovery_method: 1 });
serviceDependencySchema.index({ tenant_id: 1, last_seen_at: 1 });
serviceDependencySchema.index({ tenant_id: 1, target_service_id: 1, status: 1 });

export const ServiceDependency: Model<ServiceDependencyDocument> = mongoose.model<ServiceDependencyDocument>(
  'ServiceDependency',
  serviceDependencySchema
);
