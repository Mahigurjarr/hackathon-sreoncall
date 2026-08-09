import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IDiscoveryMethodThreshold {
  enabled: boolean;
  base_observation_threshold: number;
}

export interface ICriticalityMultiplier {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface IServiceTopologySettings {
  tenant_id: Types.ObjectId;
  cascade_enabled: boolean;
  auto_approval: {
    enabled: boolean;
    thresholds: {
      auto_otel: IDiscoveryMethodThreshold;
      auto_network: IDiscoveryMethodThreshold;
      ai_parsed: IDiscoveryMethodThreshold;
      document_upload: IDiscoveryMethodThreshold;
    };
    criticality_multiplier: ICriticalityMultiplier;
  };
}

export interface ServiceTopologySettingsDocument extends IServiceTopologySettings, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const discoveryMethodThresholdSchema = new Schema<IDiscoveryMethodThreshold>(
  {
    enabled: { type: Boolean, required: true },
    base_observation_threshold: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const criticalityMultiplierSchema = new Schema<ICriticalityMultiplier>(
  {
    critical: { type: Number, default: 4, min: 0 },
    high: { type: Number, default: 2.5, min: 0 },
    medium: { type: Number, default: 1, min: 0 },
    low: { type: Number, default: 0.5, min: 0 },
  },
  { _id: false },
);

const serviceTopologySettingsSchema = new Schema<ServiceTopologySettingsDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    cascade_enabled: { type: Boolean, default: false },
    auto_approval: {
      type: {
        enabled: { type: Boolean, default: false },
        thresholds: {
          type: {
            auto_otel: { type: discoveryMethodThresholdSchema, default: () => ({ enabled: true, base_observation_threshold: 3 }) },
            auto_network: { type: discoveryMethodThresholdSchema, default: () => ({ enabled: true, base_observation_threshold: 7 }) },
            ai_parsed: { type: discoveryMethodThresholdSchema, default: () => ({ enabled: false, base_observation_threshold: 5 }) },
            document_upload: { type: discoveryMethodThresholdSchema, default: () => ({ enabled: false, base_observation_threshold: 5 }) },
          },
          default: () => ({}),
        },
        criticality_multiplier: { type: criticalityMultiplierSchema, default: () => ({}) },
      },
      default: () => ({}),
    },
  },
  { timestamps: true, collection: 'service_topology_settings' },
);

export const ServiceTopologySettings: Model<ServiceTopologySettingsDocument> = mongoose.model<ServiceTopologySettingsDocument>(
  'ServiceTopologySettings',
  serviceTopologySettingsSchema,
);
