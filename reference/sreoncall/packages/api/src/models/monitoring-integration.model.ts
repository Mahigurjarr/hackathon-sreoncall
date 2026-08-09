import mongoose, { Document, Schema } from 'mongoose';

export type IntegrationType = 'prometheus' | 'datadog' | 'newrelic' | 'grafana' | 'mimir' | 'loki' | 'snmp_trapper';

export interface IMonitoringIntegration extends Document {
  tenant_id: Schema.Types.ObjectId;
  name: string;
  type: IntegrationType;
  endpoint_url: string;
  api_key: string;
  extra_headers: Record<string, string>;
  status: 'connected' | 'error' | 'pending';
  last_tested_at: Date | null;
  error_message: string | null;
  created_by: Schema.Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const S = new Schema<IMonitoringIntegration>(
  {
    tenant_id:      { type: Schema.Types.ObjectId, required: true, index: true },
    name:           { type: String, required: true },
    type:           { type: String, enum: ['prometheus', 'datadog', 'newrelic', 'grafana', 'mimir', 'loki', 'snmp_trapper'], required: true },
    endpoint_url:   { type: String, required: true },
    api_key:        { type: String, default: '' },
    extra_headers:  { type: Map, of: String, default: {} },
    status:         { type: String, enum: ['connected', 'error', 'pending'], default: 'pending' },
    last_tested_at: { type: Date, default: null },
    error_message:  { type: String, default: null },
    created_by:     { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, type: 1 });

export const MonitoringIntegration = mongoose.model<IMonitoringIntegration>('MonitoringIntegration', S);
