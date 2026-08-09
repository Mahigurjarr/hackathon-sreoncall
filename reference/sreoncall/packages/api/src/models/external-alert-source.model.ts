import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type ExternalAlertPlatform = 'groundcover' | 'alertmanager' | 'grafana' | 'datadog' | 'generic';

export interface IExternalAlertSource {
  tenant_id: Types.ObjectId;
  name: string;
  description: string;
  platform: ExternalAlertPlatform;
  token_hash: string;
  token_prefix: string;
  default_severity: number;
  auto_create_incident: boolean;
  auto_resolve: boolean;
  escalation_policy_id: Types.ObjectId | null;
  service_id: Types.ObjectId | null;
  labels: string[];
  created_by: Types.ObjectId;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ExternalAlertSourceDocument extends IExternalAlertSource, Document {
  _id: Types.ObjectId;
}

const schema = new Schema<ExternalAlertSourceDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    platform: {
      type: String,
      enum: ['groundcover', 'alertmanager', 'grafana', 'datadog', 'generic'],
      required: true,
    },
    token_hash: { type: String, required: true, unique: true },
    token_prefix: { type: String, required: true },
    default_severity: { type: Number, default: 3, min: 1, max: 4 },
    auto_create_incident: { type: Boolean, default: true },
    auto_resolve: { type: Boolean, default: true },
    escalation_policy_id: { type: Schema.Types.ObjectId, ref: 'EscalationPolicy', default: null },
    service_id: { type: Schema.Types.ObjectId, ref: 'Service', default: null },
    labels: [{ type: String, trim: true }],
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    last_used_at: { type: Date, default: null },
  },
  {
    collection: 'external-alert-sources',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

schema.index({ tenant_id: 1 });

export const ExternalAlertSource: Model<ExternalAlertSourceDocument> = mongoose.model<ExternalAlertSourceDocument>(
  'ExternalAlertSource',
  schema,
);
