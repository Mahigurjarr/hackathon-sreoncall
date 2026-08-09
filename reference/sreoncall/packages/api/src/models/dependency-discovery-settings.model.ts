import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type DiscoveryScheduleInterval = '1h' | '6h' | '12h' | '24h';

export interface IDependencyDiscoverySettings {
  tenant_id: Types.ObjectId;
  otel_trace_scanning_enabled: boolean;
  schedule_interval: DiscoveryScheduleInterval;
  observability_connection_id: Types.ObjectId | null;
  next_run_at: Date | null;
}

export interface DependencyDiscoverySettingsDocument extends IDependencyDiscoverySettings, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const dependencyDiscoverySettingsSchema = new Schema<DependencyDiscoverySettingsDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    otel_trace_scanning_enabled: { type: Boolean, default: false },
    schedule_interval: { type: String, enum: ['1h', '6h', '12h', '24h'], default: '6h' },
    observability_connection_id: { type: Schema.Types.ObjectId, ref: 'ObservabilityConnection', default: null },
    next_run_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'dependency_discovery_settings' },
);

export const DependencyDiscoverySettings: Model<DependencyDiscoverySettingsDocument> = mongoose.model<DependencyDiscoverySettingsDocument>(
  'DependencyDiscoverySettings',
  dependencyDiscoverySettingsSchema,
);
