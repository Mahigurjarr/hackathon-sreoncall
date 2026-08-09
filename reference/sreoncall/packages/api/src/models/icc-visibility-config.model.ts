import mongoose, { Document, Schema } from 'mongoose';

export type ICCPersona =
  | 'sre_engineer'
  | 'sre_manager'
  | 'platform_engineer'
  | 'tenant_admin'
  | 'msp_provider'
  | 'consumer'
  | 'platform_admin';

export type ICCVisibilityLevel = 'full' | 'view' | 'summary' | 'own' | 'hidden';

export interface IIccVisibilityConfig extends Document {
  tenant_id: Schema.Types.ObjectId;
  persona: ICCPersona;
  overrides: Map<string, ICCVisibilityLevel>;
  updated_by: Schema.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const S = new Schema<IIccVisibilityConfig>(
  {
    tenant_id:              { type: Schema.Types.ObjectId, required: true },
    persona:                { type: String, enum: ['sre_engineer', 'sre_manager', 'platform_engineer', 'tenant_admin', 'msp_provider', 'consumer', 'platform_admin'], required: true },
    overrides:              { type: Map, of: { type: String, enum: ['full', 'view', 'summary', 'own', 'hidden'] }, default: {} },
    updated_by:             { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, persona: 1 }, { unique: true });

export const IccVisibilityConfig = mongoose.model<IIccVisibilityConfig>('IccVisibilityConfig', S, 'icc_visibility_configs');
