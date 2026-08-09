import mongoose, { Document, Schema } from 'mongoose';

export interface ISloDefinition extends Document {
  tenant_id: Schema.Types.ObjectId;
  service_id: Schema.Types.ObjectId;
  name: string;
  description: string;
  sli: {
    source: 'managed_promql' | 'managed_logql' | 'synthetic' | 'byos';
    query_good: string;
    query_total: string;
    synthetic_check_id: Schema.Types.ObjectId | null;
  };
  objective_pct: number;
  window_days: number;
  alert_on_burn_rate: boolean;
  burn_rate_thresholds: {
    fast_burn: number;
    slow_burn: number;
  };
  status: 'active' | 'inactive';
  // Predictive alerts config
  predictive_alerts: {
    enabled: boolean;
    warn_at_budget_percent: number;
    critical_at_budget_percent: number;
  };
  // Multi-window burn rate data
  burn_rate_data: {
    current_1h: number | null;
    current_6h: number | null;
    current_24h: number | null;
    forecast_breach_at: Date | null;
    forecast_confidence: number | null;
  };
  // Computed state
  current_sli_pct: number | null;
  error_budget_remaining_pct: number | null;
  burn_rate: number | null;
  last_evaluated_at: Date | null;
  created_by: Schema.Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const S = new Schema<ISloDefinition>(
  {
    tenant_id:           { type: Schema.Types.ObjectId, required: true, index: true },
    service_id:          { type: Schema.Types.ObjectId, required: true, index: true },
    name:                { type: String, required: true },
    description:         { type: String, default: '' },
    sli: {
      source:            { type: String, enum: ['managed_promql', 'managed_logql', 'synthetic', 'byos'], required: true },
      query_good:        { type: String, default: '' },
      query_total:       { type: String, default: '' },
      synthetic_check_id:{ type: Schema.Types.ObjectId, default: null },
    },
    objective_pct:       { type: Number, required: true },
    window_days:         { type: Number, default: 30 },
    alert_on_burn_rate:  { type: Boolean, default: true },
    burn_rate_thresholds: {
      fast_burn:         { type: Number, default: 14.4 },
      slow_burn:         { type: Number, default: 6 },
    },
    status:              { type: String, enum: ['active', 'inactive'], default: 'active' },
    predictive_alerts: {
      enabled:                     { type: Boolean, default: false },
      warn_at_budget_percent:      { type: Number, default: 50 },
      critical_at_budget_percent:  { type: Number, default: 80 },
    },
    burn_rate_data: {
      current_1h:            { type: Number, default: null },
      current_6h:            { type: Number, default: null },
      current_24h:           { type: Number, default: null },
      forecast_breach_at:    { type: Date, default: null },
      forecast_confidence:   { type: Number, default: null },
    },
    current_sli_pct:     { type: Number, default: null },
    error_budget_remaining_pct: { type: Number, default: null },
    burn_rate:           { type: Number, default: null },
    last_evaluated_at:   { type: Date, default: null },
    created_by:          { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, service_id: 1 });
S.index({ tenant_id: 1, status: 1 });

export const SloDefinition = mongoose.model<ISloDefinition>('SloDefinition', S, 'slo_definitions');
