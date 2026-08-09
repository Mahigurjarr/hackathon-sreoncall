import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface TimelineEntry {
  _id: Types.ObjectId;
  timestamp: Date;
  type:
    | 'declaration'
    | 'acknowledgment'
    | 'status_change'
    | 'severity_change'
    | 'role_assigned'
    | 'alert'
    | 'ai_insight'
    | 'runbook_started'
    | 'runbook_step'
    | 'note'
    | 'escalation'
    | 'resolution'
    | 'comms_sent'
    | 'provider_escalation'
    | 'bridge_sync'
    | 'system';
  actor_id: Types.ObjectId | null;
  message: string;
  metadata: Record<string, unknown>;
}

export interface Responder {
  user_id: Types.ObjectId;
  role: string;
  joined_at: Date;
  left_at: Date | null;
}

export interface IncidentMetrics {
  ack_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  mtta_seconds: number | null;
  mttr_seconds: number | null;
}

export interface ProviderHandover {
  provider_tenant_id: Types.ObjectId;
  provider_tenant_slug: string;
  provider_tenant_name: string;
  provider_incident_id: Types.ObjectId;
  provider_incident_number: number;
  tier: number;
  label: string;
  current_user_id: Types.ObjectId | null;
  current_user_name: string | null;
  started_at: Date;
}

export interface IIncident {
  tenant_id: Types.ObjectId;
  number: number;
  title: string;
  description: string;
  severity: 1 | 2 | 3 | 4 | 5;
  status: 'open' | 'acknowledged' | 'investigating' | 'monitoring' | 'resolved' | 'closed';
  type: 'reliability' | 'performance' | 'security' | 'availability' | 'other';
  source: 'manual' | 'alert' | 'webhook' | 'ai' | 'synthetic_check' | 'security_monitoring';
  source_alert_id: Types.ObjectId | null;
  source_synthetic_check_id: Types.ObjectId | null;
  affected_service_ids: Types.ObjectId[];
  commander_id: Types.ObjectId | null;
  comms_lead_id: Types.ObjectId | null;
  operations_lead_id: Types.ObjectId | null;
  responders: Responder[];
  timeline: TimelineEntry[];
  metrics: IncidentMetrics;
  ai: {
    root_cause: string | null;
    confidence: number | null;
    recommended_runbook_ids: Types.ObjectId[];
    last_analyzed_at: Date | null;
  };
  linked_ticket_ids: Types.ObjectId[];
  linked_change_ids: Types.ObjectId[];
  runbook_execution_ids: Types.ObjectId[];
  postmortem_id: Types.ObjectId | null;
  war_room_channel_id: Types.ObjectId | null;
  escalation_policy_id: Types.ObjectId | null;
  labels: string[];
  custom_fields: Record<string, unknown>;
  watcher_ids: Types.ObjectId[];
  created_by: Types.ObjectId;
  resolved_at: Date | null;
  closed_at: Date | null;
  slack_message_ts: string | null;
  slack_channel_id: string | null;
  slack_notifications: Array<{ channel_id: string; ts: string }>;
  source_consumer_tenant_id: Types.ObjectId | null;
  provider_handover: ProviderHandover | null;
}

export interface IncidentDocument extends IIncident, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const timelineSchema = new Schema<TimelineEntry>(
  {
    timestamp: { type: Date, default: () => new Date() },
    type: {
      type: String,
      enum: [
        'declaration', 'acknowledgment', 'status_change', 'severity_change',
        'role_assigned', 'alert', 'ai_insight', 'runbook_started', 'runbook_step',
        'note', 'escalation', 'resolution', 'comms_sent',
        'provider_escalation', 'bridge_sync', 'system',
      ],
      required: true,
    },
    actor_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    message: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const responderSchema = new Schema<Responder>(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true, default: 'responder' },
    joined_at: { type: Date, default: () => new Date() },
    left_at: { type: Date, default: null },
  },
  { _id: false }
);

const metricsSchema = new Schema<IncidentMetrics>(
  {
    ack_at: { type: Date, default: null },
    resolved_at: { type: Date, default: null },
    closed_at: { type: Date, default: null },
    mtta_seconds: { type: Number, default: null },
    mttr_seconds: { type: Number, default: null },
  },
  { _id: false }
);

const providerHandoverSchema = new Schema<ProviderHandover>(
  {
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    provider_tenant_slug: { type: String, default: '' },
    provider_tenant_name: { type: String, default: '' },
    provider_incident_id: { type: Schema.Types.ObjectId, required: true },
    provider_incident_number: { type: Number, required: true },
    tier: { type: Number, default: 0 },
    label: { type: String, required: true },
    current_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    current_user_name: { type: String, default: null },
    started_at: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const incidentSchema = new Schema<IncidentDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    number: { type: Number, required: true },
    title: { type: String, required: true, trim: true, maxlength: 500 },
    description: { type: String, default: '', maxlength: 50000 },
    severity: { type: Number, required: true, min: 1, max: 5, default: 3 },
    status: {
      type: String,
      enum: ['open', 'acknowledged', 'investigating', 'monitoring', 'resolved', 'closed'],
      default: 'open',
    },
    type: {
      type: String,
      enum: ['reliability', 'performance', 'security', 'availability', 'other'],
      default: 'other',
    },
    source: {
      type: String,
      enum: ['manual', 'alert', 'webhook', 'ai', 'synthetic_check', 'security_monitoring'],
      default: 'manual',
    },
    source_alert_id: { type: Schema.Types.ObjectId, ref: 'AlertRule', default: null },
    source_synthetic_check_id: { type: Schema.Types.ObjectId, ref: 'SyntheticCheck', default: null },
    affected_service_ids: [{ type: Schema.Types.ObjectId, ref: 'Service' }],
    commander_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    comms_lead_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    operations_lead_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    responders: [responderSchema],
    timeline: [timelineSchema],
    metrics: { type: metricsSchema, default: () => ({}) },
    ai: {
      root_cause: { type: String, default: null },
      confidence: { type: Number, default: null },
      recommended_runbook_ids: [{ type: Schema.Types.ObjectId, ref: 'Runbook' }],
      last_analyzed_at: { type: Date, default: null },
    },
    linked_ticket_ids: [{ type: Schema.Types.ObjectId, ref: 'Ticket' }],
    linked_change_ids: [{ type: Schema.Types.ObjectId, ref: 'Change' }],
    runbook_execution_ids: [{ type: Schema.Types.ObjectId }],
    postmortem_id: { type: Schema.Types.ObjectId, ref: 'Postmortem', default: null },
    war_room_channel_id: { type: Schema.Types.ObjectId, ref: 'Channel', default: null },
    escalation_policy_id: { type: Schema.Types.ObjectId, ref: 'EscalationPolicy', default: null },
    labels: [{ type: String, trim: true }],
    custom_fields: { type: Schema.Types.Mixed, default: {} },
    watcher_ids: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resolved_at: { type: Date, default: null },
    closed_at: { type: Date, default: null },
    slack_message_ts: { type: String, default: null },
    slack_channel_id: { type: String, default: null },
    slack_notifications: {
      type: [{ channel_id: String, ts: String }],
      default: [],
    },
    source_consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
    provider_handover: { type: providerHandoverSchema, default: null },
  },
  {
    timestamps: true,
    collection: 'incidents',
  }
);

incidentSchema.index({ tenant_id: 1, status: 1, severity: 1 });
incidentSchema.index({ tenant_id: 1, number: 1 }, { unique: true });
incidentSchema.index({ tenant_id: 1, createdAt: -1 });

export const Incident: Model<IncidentDocument> = mongoose.model<IncidentDocument>('Incident', incidentSchema);
