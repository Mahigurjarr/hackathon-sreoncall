import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type TierLevel = 1 | 2 | 3;
export type IncidentSlaStatus = 'active' | 'resolved' | 'breached';
export type TierHistoryReason = 'initial' | 'escalation_timeout' | 'manual_escalation' | 'resolved';

export interface ISlaWindow {
  target_minutes: number;
  deadline_at: Date;
  met_at: Date | null;
  breached: boolean;
}

export interface ITierHistoryEntry {
  level: TierLevel;
  started_at: Date;
  ended_at: Date | null;
  reason: TierHistoryReason;
}

export interface IIncidentSLAState {
  incident_bridge_id: Types.ObjectId;
  contract_id: Types.ObjectId;
  consumer_incident_id: Types.ObjectId;
  provider_incident_id: Types.ObjectId;
  consumer_tenant_id: Types.ObjectId;
  provider_tenant_id: Types.ObjectId;

  current_tier: TierLevel;
  tier_started_at: Date;
  tier_deadline: Date | null;

  response_sla: ISlaWindow;
  resolution_sla: ISlaWindow;

  tier_history: ITierHistoryEntry[];

  status: IncidentSlaStatus;
}

export interface IncidentSLAStateDocument extends IIncidentSLAState, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const slaWindowSchema = new Schema<ISlaWindow>(
  {
    target_minutes: { type: Number, required: true, min: 1 },
    deadline_at: { type: Date, required: true },
    met_at: { type: Date, default: null },
    breached: { type: Boolean, default: false },
  },
  { _id: false }
);

const tierHistorySchema = new Schema<ITierHistoryEntry>(
  {
    level: { type: Number, enum: [1, 2, 3], required: true },
    started_at: { type: Date, required: true },
    ended_at: { type: Date, default: null },
    reason: {
      type: String,
      enum: ['initial', 'escalation_timeout', 'manual_escalation', 'resolved'],
      required: true,
    },
  },
  { _id: false }
);

const incidentSlaStateSchema = new Schema<IncidentSLAStateDocument>(
  {
    incident_bridge_id: { type: Schema.Types.ObjectId, ref: 'IncidentBridge', required: true },
    contract_id: { type: Schema.Types.ObjectId, ref: 'SupportContract', required: true },
    consumer_incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    provider_incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    current_tier: { type: Number, enum: [1, 2, 3], default: 1 },
    tier_started_at: { type: Date, required: true },
    tier_deadline: { type: Date, default: null },
    response_sla: { type: slaWindowSchema, required: true },
    resolution_sla: { type: slaWindowSchema, required: true },
    tier_history: { type: [tierHistorySchema], default: [] },
    status: {
      type: String,
      enum: ['active', 'resolved', 'breached'],
      default: 'active',
    },
  },
  {
    timestamps: true,
    collection: 'incident_sla_states',
  }
);

incidentSlaStateSchema.index({ incident_bridge_id: 1 }, { unique: true });
incidentSlaStateSchema.index({ status: 1, tier_deadline: 1 });
incidentSlaStateSchema.index({ contract_id: 1, status: 1 });
incidentSlaStateSchema.index({ provider_tenant_id: 1, status: 1 });

export const IncidentSLAState: Model<IncidentSLAStateDocument> = mongoose.model<IncidentSLAStateDocument>(
  'IncidentSLAState',
  incidentSlaStateSchema
);
