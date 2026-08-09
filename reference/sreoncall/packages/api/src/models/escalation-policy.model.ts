import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type NotifyChannel = 'email' | 'sms' | 'slack' | 'teams' | 'in_app' | 'voice' | 'whatsapp';

export interface IEscalationStep {
  delay_minutes: number;
  targets: Types.ObjectId[];
  target_type: 'user' | 'team' | 'schedule' | 'provider_escalation';
  provider_policy_id?: Types.ObjectId;
  timeout_minutes?: number;
  note?: string;
  notify_channels: NotifyChannel[];
}

export interface IEscalationPolicy {
  tenant_id: Types.ObjectId;
  name: string;
  description: string;
  status: 'active' | 'disabled';
  steps: IEscalationStep[];
  repeat_count: number;
  repeat_interval_minutes: number;
  created_by: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export interface EscalationPolicyDocument extends IEscalationPolicy, Document {
  _id: Types.ObjectId;
}

const escalationStepSchema = new Schema<IEscalationStep>(
  {
    delay_minutes: { type: Number, required: true, min: 0, default: 5 },
    targets: [{ type: Schema.Types.ObjectId }],
    target_type: { type: String, enum: ['user', 'team', 'schedule', 'provider_escalation'], default: 'user' },
    provider_policy_id: { type: Schema.Types.ObjectId, ref: 'EscalationPolicy', default: null },
    timeout_minutes: { type: Number, min: 0, default: null },
    note: { type: String, maxlength: 500 },
    notify_channels: { type: [String], enum: ['email', 'sms', 'slack', 'teams', 'in_app', 'voice', 'whatsapp'], default: ['in_app', 'email'] },
  },
  { _id: false }
);

const escalationPolicySchema = new Schema<EscalationPolicyDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    steps: [escalationStepSchema],
    repeat_count: { type: Number, default: 0, min: 0 },
    repeat_interval_minutes: { type: Number, default: 30, min: 1 },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'escalation-policies',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

escalationPolicySchema.index({ tenant_id: 1 });

export const EscalationPolicy: Model<EscalationPolicyDocument> = mongoose.model<EscalationPolicyDocument>(
  'EscalationPolicy',
  escalationPolicySchema
);
