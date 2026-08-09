import mongoose, { Document, Schema } from 'mongoose';

export interface IObservabilityConnection extends Document {
  tenant_id: Schema.Types.ObjectId;
  name: string;
  mode: 'managed' | 'byos' | 'third_party';
  vendor: 'mimir' | 'prometheus' | 'loki' | 'tempo' | 'datadog' | 'new_relic' | 'cloudwatch' | 'splunk' | 'elastic' | 'gcp_monitoring' | 'azure_monitor' | null;
  endpoints: {
    metrics_url: string;
    logs_url: string;
    traces_url: string;
  };
  vault_secret_path: string;
  status: 'connected' | 'error' | 'pending' | 'disabled';
  last_health_check_at: Date | null;
  health_check_message: string;
  config: Record<string, unknown>;
  /**
   * Customer-defined labels stamped on every telemetry stream that flows
   * through this connection (logs, metrics, traces). Examples:
   *   { environment: 'production', team: 'payments', tier: 'tier-1' }
   * Label key rules enforced by validateLabelKey below; reserved keys
   * (tenant_id / source / service_name / job) are rejected.
   */
  default_labels: Record<string, string>;
  created_by: Schema.Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

/** Keys the platform owns — customers can't override these via default_labels. */
export const RESERVED_LABEL_KEYS = new Set([
  'tenant_id',
  'source',
  'service_name',
  'job',
  'emitter',
  '__name__',
]);

/** Enforce Prometheus/Loki label-name rules + reject reserved keys. */
export function validateLabelKey(key: string): string | null {
  if (!key) return 'empty';
  if (!/^[a-z_][a-z0-9_]*$/.test(key)) return 'must match [a-z_][a-z0-9_]*';
  if (RESERVED_LABEL_KEYS.has(key)) return 'reserved';
  if (key.length > 64) return 'too long (max 64 chars)';
  return null;
}

/** Values: printable, non-empty, bounded length, no newlines. */
export function validateLabelValue(value: string): string | null {
  if (value === null || value === undefined) return 'empty';
  const s = String(value);
  if (s.length === 0) return 'empty';
  if (s.length > 256) return 'too long (max 256 chars)';
  if (/[\n\r\t]/.test(s)) return 'contains control characters';
  return null;
}

const S = new Schema<IObservabilityConnection>(
  {
    tenant_id:           { type: Schema.Types.ObjectId, required: true, index: true },
    name:                { type: String, required: true },
    mode:                { type: String, enum: ['managed', 'byos', 'third_party'], required: true },
    vendor:              { type: String, default: null },
    endpoints: {
      metrics_url:       { type: String, default: '' },
      logs_url:          { type: String, default: '' },
      traces_url:        { type: String, default: '' },
    },
    vault_secret_path:   { type: String, default: '' },
    status:              { type: String, enum: ['connected', 'error', 'pending', 'disabled'], default: 'pending' },
    last_health_check_at:{ type: Date, default: null },
    health_check_message:{ type: String, default: '' },
    config:              { type: Schema.Types.Mixed, default: {} },
    default_labels: {
      type: Map,
      of: String,
      default: () => new Map<string, string>(),
      validate: {
        validator(value: Map<string, string> | Record<string, string> | undefined) {
          if (!value) return true;
          const entries =
            value instanceof Map ? Array.from(value.entries()) : Object.entries(value);
          for (const [k, v] of entries) {
            if (validateLabelKey(k)) return false;
            if (validateLabelValue(v)) return false;
          }
          return true;
        },
        message:
          'default_labels contain invalid keys (must be [a-z_][a-z0-9_]*, not reserved) or values (1–256 chars, no control characters)',
      },
    },
    created_by:          { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, mode: 1 });

export const ObservabilityConnection = mongoose.model<IObservabilityConnection>(
  'ObservabilityConnection',
  S,
  'observability_connections',
);
