import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface TenantOverride {
  tenant_id: Types.ObjectId;
  value: boolean;
}

export interface IFeatureFlag {
  key: string;
  description: string;
  default_value: boolean;
  tenant_overrides: TenantOverride[];
}

export interface FeatureFlagDocument extends IFeatureFlag, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const tenantOverrideSchema = new Schema<TenantOverride>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    value: { type: Boolean, required: true },
  },
  { _id: false }
);

const featureFlagSchema = new Schema<FeatureFlagDocument>(
  {
    key: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 500 },
    default_value: { type: Boolean, default: false },
    tenant_overrides: [tenantOverrideSchema],
  },
  {
    timestamps: true,
    collection: 'feature-flags',
  }
);

featureFlagSchema.index({ key: 1 }, { unique: true });

export const FeatureFlag: Model<FeatureFlagDocument> = mongoose.model<FeatureFlagDocument>(
  'FeatureFlag',
  featureFlagSchema
);
