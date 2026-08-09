import mongoose, { Document, Schema } from 'mongoose';

export interface IAlertRuleSilence {
  _id: Schema.Types.ObjectId;
  start: Date;
  end: Date;
  reason: string;
  created_by: Schema.Types.ObjectId;
}

export interface IAlertRuleRouting {
  escalation_policy_id: Schema.Types.ObjectId | null;
  oncall_schedule_id: Schema.Types.ObjectId | null;
  additional_channels: string[];
}

export interface IAlertRule extends Document {
  tenant_id: Schema.Types.ObjectId;
  name: string;
  description: string;
  service_id: Schema.Types.ObjectId | null;
  status: 'active' | 'inactive';
  severity: 'critical' | 'high' | 'medium' | 'low';
  source_type: 'managed_promql' | 'managed_logql' | 'byos_webhook' | 'synthetic' | 'snmp_trap';
  synthetic_check_id: Schema.Types.ObjectId | null;
  query: string | null;
  condition: {
    metric: string;
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'expr' | 'absent';
    threshold: number;
    window_minutes: number;
    query?: string | null;
  };
  // Compound conditions: when non-empty, all of these are evaluated and
  // combined with `condition_logic`. `condition` mirrors conditions[0] for
  // backward compatibility with older readers/evaluators.
  conditions: Array<{
    metric: string;
    operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'expr' | 'absent';
    threshold: number;
    window_minutes: number;
    query?: string | null;
  }>;
  condition_logic: 'and' | 'or';
  for_duration_seconds: number;
  labels: Map<string, string>;
  routing: IAlertRuleRouting;
  active_silences: IAlertRuleSilence[];
  auto_create_incident: boolean;
  incident_severity: 'sev1' | 'sev2' | 'sev3' | 'sev4';
  notification_channels: string[];
  webhook_url: string | null;
  webhook_secret: string | null;
  last_triggered_at: Date | null;
  last_webhook_at: Date | null;
  last_value: number | null;
  alert_state: 'ok' | 'firing' | 'no_data' | 'pending';
  pending_since: Date | null;
  pending_fingerprint: string | null;
  last_firing_labels: Record<string, string> | null;
  trigger_count: number;
  is_predefined: boolean;
  template_id: string | null;
  category: string | null;
  created_by: Schema.Types.ObjectId | null;
  created_at: Date;
  updated_at: Date;
}

const conditionSchema = new Schema(
  {
    // For metric-threshold conditions: the metric name (or PromQL/LogQL
    // fragment) whose value is compared to `threshold`. Not required for
    // `expr` conditions, where the whole `query` is the firing signal.
    metric: { type: String, default: '' },
    // `expr` = native PromQL/LogQL: fire when `query` returns a non-empty
    // result vector (standard Prometheus alerting semantics); the platform
    // does not apply a threshold comparison.
    // `absent` = the inverse of `expr`: fire when `query` returns NOTHING
    // (empty vector / zero log lines). Use it to alert when a signal goes dark
    // — e.g. a service stops shipping logs or a target disappears.
    operator: { type: String, enum: ['gt', 'lt', 'gte', 'lte', 'eq', 'expr', 'absent'], default: 'gt' },
    threshold: { type: Number, default: 0 },
    window_minutes: { type: Number, default: 5 },
    // Optional per-condition expression, used when operator is `expr` (or to
    // override the rule-level query for this condition).
    query: { type: String, default: null },
  },
  { _id: false },
);

const routingSchema = new Schema(
  {
    escalation_policy_id: { type: Schema.Types.ObjectId, ref: 'EscalationPolicy', default: null },
    oncall_schedule_id: { type: Schema.Types.ObjectId, ref: 'OncallSchedule', default: null },
    additional_channels: [{ type: String }],
  },
  { _id: false },
);

const silenceSchema = new Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    reason: { type: String, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
);

const S = new Schema<IAlertRule>(
  {
    tenant_id: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    service_id: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'medium' },
    source_type: { type: String, enum: ['managed_promql', 'managed_logql', 'byos_webhook', 'synthetic', 'snmp_trap'], default: 'managed_promql' },
    synthetic_check_id: { type: Schema.Types.ObjectId, ref: 'SyntheticCheck', default: null },
    query: { type: String, default: null },
    condition: { type: conditionSchema, required: true },
    // Compound conditions. Empty => single-condition rule driven by `condition`.
    conditions: { type: [conditionSchema], default: [] },
    condition_logic: { type: String, enum: ['and', 'or'], default: 'and' },
    for_duration_seconds: { type: Number, default: 300 },
    labels: { type: Map, of: String, default: () => new Map() },
    routing: { type: routingSchema, default: () => ({ escalation_policy_id: null, oncall_schedule_id: null, additional_channels: [] }) },
    active_silences: { type: [silenceSchema], default: [] },
    auto_create_incident: { type: Boolean, default: true },
    incident_severity: { type: String, enum: ['sev1', 'sev2', 'sev3', 'sev4'], default: 'sev3' },
    notification_channels: [String],
    webhook_url: { type: String, default: null },
    webhook_secret: { type: String, default: null },
    last_triggered_at: { type: Date, default: null },
    last_webhook_at: { type: Date, default: null },
    last_value: { type: Number, default: null },
    alert_state: { type: String, enum: ['ok', 'firing', 'no_data', 'pending'], default: 'ok' },
    pending_since: { type: Date, default: null },
    pending_fingerprint: { type: String, default: null },
    last_firing_labels: { type: Schema.Types.Mixed, default: null },
    trigger_count: { type: Number, default: 0 },
    is_predefined: { type: Boolean, default: false },
    template_id: { type: String, default: null },
    category: { type: String, default: null },
    created_by: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, status: 1 });
S.index({ tenant_id: 1, service_id: 1 });
S.index({ tenant_id: 1, synthetic_check_id: 1 });
S.index({ tenant_id: 1, name: 1 }, { unique: true, name: 'tenant_id_1_name_1_unique' });

export const AlertRule = mongoose.model<IAlertRule>('AlertRule', S, 'alertrules');
