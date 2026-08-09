import mongoose, { Schema, Document, Model, Types } from 'mongoose';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ScheduleRestriction {
  start_hour: number;   // 0–23
  end_hour: number;     // 0–23
  days: number[];       // 0=Sun … 6=Sat
}

export interface ScheduleLayer {
  id: string;
  name: string;
  rotation_type: 'weekly' | 'daily' | 'monthly' | 'custom_hours';
  users: Types.ObjectId[];
  start_time: string;       // "HH:MM" in schedule timezone
  end_time: string;         // "HH:MM" in schedule timezone
  timezone: string;
  handoff_day?: number | null;  // deprecated, kept for backward compat
  rotation_length_seconds: number;
  restrictions: ScheduleRestriction[];
}

export interface ScheduleOverride {
  id: string;
  user_id: Types.ObjectId;
  layer_id: string | null;
  start: Date;
  end: Date;
  reason: string | null;
  created_by: Types.ObjectId;
  created_at: Date;
}

export interface IOnCallSchedule {
  tenant_id: Types.ObjectId;
  name: string;
  description: string;
  timezone: string;
  enabled: boolean;
  layers: ScheduleLayer[];
  overrides: ScheduleOverride[];
  service_ids: Types.ObjectId[];
  escalation_policy_id: Types.ObjectId | null;
  created_by: Types.ObjectId;
}

export interface OnCallScheduleDocument extends IOnCallSchedule, Document {
  _id: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const restrictionSchema = new Schema<ScheduleRestriction>(
  {
    start_hour: { type: Number, min: 0, max: 23, required: true },
    end_hour:   { type: Number, min: 0, max: 23, required: true },
    days:       [{ type: Number, min: 0, max: 6 }],
  },
  { _id: false }
);

const layerSchema = new Schema<ScheduleLayer>(
  {
    id:                    { type: String, required: true },
    name:                  { type: String, required: true, trim: true },
    rotation_type:         { type: String, enum: ['weekly', 'daily', 'monthly', 'custom_hours'], default: 'weekly' },
    users:                 [{ type: Schema.Types.ObjectId, ref: 'User' }],
    start_time:            { type: String, default: '09:00' },  // HH:MM
    end_time:              { type: String, default: '17:00' },  // HH:MM
    timezone:              { type: String, default: 'UTC' },
    handoff_day:           { type: Number, min: 0, max: 6, default: null },  // kept for backward compat

    rotation_length_seconds: { type: Number, default: 604800 },  // 7 days
    restrictions:          [restrictionSchema],
  },
  { _id: true }
);

const overrideSchema = new Schema<ScheduleOverride>(
  {
    id:          { type: String, required: true },
    user_id:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    layer_id:    { type: String, default: null },
    start:       { type: Date, required: true },
    end:         { type: Date, required: true },
    reason:      { type: String, default: null },
    created_by:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    created_at:  { type: Date, default: () => new Date() },
  },
  { _id: true }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const oncallScheduleSchema = new Schema<OnCallScheduleDocument>(
  {
    tenant_id:            { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name:                 { type: String, required: true, trim: true, maxlength: 200 },
    description:          { type: String, default: '', maxlength: 2000 },
    timezone:             { type: String, default: 'UTC' },
    enabled:              { type: Boolean, default: true },
    layers:               [layerSchema],
    overrides:            [overrideSchema],
    service_ids:          [{ type: Schema.Types.ObjectId, ref: 'Service' }],
    escalation_policy_id: { type: Schema.Types.ObjectId, ref: 'EscalationPolicy', default: null },
    created_by:           { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'oncallschedules',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

oncallScheduleSchema.index({ tenant_id: 1, name: 1 });
oncallScheduleSchema.index({ tenant_id: 1, created_at: -1 });

export const OnCallSchedule: Model<OnCallScheduleDocument> =
  (mongoose.models.OnCallSchedule as Model<OnCallScheduleDocument>)
  || mongoose.model<OnCallScheduleDocument>('OnCallSchedule', oncallScheduleSchema);
