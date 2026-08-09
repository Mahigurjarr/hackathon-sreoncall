import mongoose, { Document, Schema } from 'mongoose';

export interface IValidationSuiteCheck {
  name: string;
  type: 'http' | 'tcp' | 'custom_script';
  config: {
    // HTTP
    url: string | null;
    method: string | null;
    headers: Record<string, string> | null;
    expected_status: number | null;
    expected_body_contains: string | null;
    timeout_ms: number | null;
    // TCP
    host: string | null;
    port: number | null;
    // Custom script (webhook callback)
    webhook_url: string | null;
  };
  order: number;
}

export interface IValidationSuite extends Document {
  tenant_id: Schema.Types.ObjectId;
  name: string;
  description: string | null;
  service_ids: Schema.Types.ObjectId[];
  checks: IValidationSuiteCheck[];
  trigger: 'manual' | 'on_resolution' | 'both';
  created_by: Schema.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const checkSchema = new Schema<IValidationSuiteCheck>(
  {
    name:                   { type: String, required: true },
    type:                   { type: String, enum: ['http', 'tcp', 'custom_script'], required: true },
    config: {
      // HTTP
      url:                  { type: String, default: null },
      method:               { type: String, default: null },
      headers:              { type: Map, of: String, default: null },
      expected_status:      { type: Number, default: null },
      expected_body_contains: { type: String, default: null },
      timeout_ms:           { type: Number, default: null },
      // TCP
      host:                 { type: String, default: null },
      port:                 { type: Number, default: null },
      // Custom script
      webhook_url:          { type: String, default: null },
    },
    order:                  { type: Number, default: 0 },
  },
  { _id: true },
);

const S = new Schema<IValidationSuite>(
  {
    tenant_id:              { type: Schema.Types.ObjectId, required: true, index: true },
    name:                   { type: String, required: true },
    description:            { type: String, default: null },
    service_ids:            [{ type: Schema.Types.ObjectId, ref: 'Service' }],
    checks:                 [checkSchema],
    trigger:                { type: String, enum: ['manual', 'on_resolution', 'both'], default: 'manual' },
    created_by:             { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, service_ids: 1 });

export const ValidationSuite = mongoose.model<IValidationSuite>('ValidationSuite', S, 'validation_suites');
