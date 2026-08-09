import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IWorkLogApprover {
  user_id: Types.ObjectId;
  scope: 'tenant' | 'project';
  project_id?: Types.ObjectId;
}

export interface IWorkLogSettings {
  tenant_id: Types.ObjectId;
  approvers: IWorkLogApprover[];
  digest_interval_days: number;
  auto_approve_threshold_minutes: number;
  approval_sla_days: number;
  approval_sla_action: 'escalate' | 'auto_approve' | 'notify_admin';
  last_digest_sent_at: Date | null;
  sla_breach_notified_at: Date | null;
}

export interface WorkLogSettingsDocument extends IWorkLogSettings, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const approverSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scope: { type: String, enum: ['tenant', 'project'], default: 'tenant' },
    project_id: { type: Schema.Types.ObjectId, ref: 'Project' },
  },
  { _id: false },
);

const workLogSettingsSchema = new Schema<WorkLogSettingsDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    approvers: { type: [approverSchema], default: [] },
    digest_interval_days: { type: Number, default: 3, min: 1, max: 30 },
    auto_approve_threshold_minutes: { type: Number, default: 0, min: 0 },
    approval_sla_days: { type: Number, default: 0, min: 0 },
    approval_sla_action: {
      type: String,
      enum: ['escalate', 'auto_approve', 'notify_admin'],
      default: 'notify_admin',
    },
    last_digest_sent_at: { type: Date, default: null },
    sla_breach_notified_at: { type: Date, default: null },
  },
  { timestamps: true, collection: 'work_log_settings' },
);

export const WorkLogSettings: Model<WorkLogSettingsDocument> = mongoose.model<WorkLogSettingsDocument>(
  'WorkLogSettings',
  workLogSettingsSchema,
);
