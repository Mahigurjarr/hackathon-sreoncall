import mongoose, { Document, Schema } from 'mongoose';

export interface IToilRecord extends Document {
  tenant_id: Schema.Types.ObjectId;
  type: 'manual_action' | 'runbook_repeat' | 'alert_dismiss' | 'incident_repeat';
  description: string;
  service_id: Schema.Types.ObjectId | null;
  user_id: Schema.Types.ObjectId;
  source: {
    incident_id: Schema.Types.ObjectId | null;
    runbook_id: Schema.Types.ObjectId | null;
    runbook_step_title: string | null;
    alert_rule_id: Schema.Types.ObjectId | null;
  };
  duration_seconds: number | null;
  automatable: boolean;
  automation_suggestion: string | null;
  created_at: Date;
}

const S = new Schema<IToilRecord>(
  {
    tenant_id:              { type: Schema.Types.ObjectId, required: true },
    type:                   { type: String, enum: ['manual_action', 'runbook_repeat', 'alert_dismiss', 'incident_repeat'], required: true },
    description:            { type: String, required: true },
    service_id:             { type: Schema.Types.ObjectId, ref: 'Service', default: null },
    user_id:                { type: Schema.Types.ObjectId, ref: 'User', required: true },
    source: {
      incident_id:          { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
      runbook_id:           { type: Schema.Types.ObjectId, ref: 'Runbook', default: null },
      runbook_step_title:   { type: String, default: null },
      alert_rule_id:        { type: Schema.Types.ObjectId, ref: 'AlertRule', default: null },
    },
    duration_seconds:       { type: Number, default: null },
    automatable:            { type: Boolean, default: false },
    automation_suggestion:  { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } },
);

S.index({ tenant_id: 1, user_id: 1, created_at: -1 });
S.index({ tenant_id: 1, service_id: 1 });
S.index({ tenant_id: 1, type: 1, created_at: -1 });

export const ToilRecord = mongoose.model<IToilRecord>('ToilRecord', S, 'toil_records');
