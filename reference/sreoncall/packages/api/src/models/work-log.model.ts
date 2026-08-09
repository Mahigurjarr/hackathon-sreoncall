import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IWorkLog {
  tenant_id: Types.ObjectId;
  entity_type: 'ticket' | 'incident';
  entity_id: Types.ObjectId;
  user_id: Types.ObjectId;
  duration_minutes: number;
  description: string;
  logged_at: Date;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: Types.ObjectId;
  approved_at?: Date;
  rejection_reason?: string;
  source: 'internal' | 'provider';
  source_tenant_id?: Types.ObjectId;
  source_work_log_id?: Types.ObjectId;
  source_user_name?: string;
  billable: boolean;
}

export interface WorkLogDocument extends IWorkLog, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const workLogSchema = new Schema<WorkLogDocument>(
  {
    tenant_id:        { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    entity_type:      { type: String, enum: ['ticket', 'incident'], required: true },
    entity_id:        { type: Schema.Types.ObjectId, required: true, index: true },
    user_id:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
    duration_minutes: { type: Number, required: true, min: 1 },
    description:      { type: String, default: '', maxlength: 5000 },
    logged_at:        { type: Date, default: () => new Date() },
    status:           { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approved_by:      { type: Schema.Types.ObjectId, ref: 'User' },
    approved_at:      { type: Date },
    rejection_reason: { type: String, maxlength: 2000 },
    source:           { type: String, enum: ['internal', 'provider'], default: 'internal' },
    source_tenant_id: { type: Schema.Types.ObjectId },
    source_work_log_id: { type: Schema.Types.ObjectId },
    source_user_name: { type: String, maxlength: 200 },
    billable:         { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'work_logs',
  }
);

workLogSchema.index({ tenant_id: 1, entity_type: 1, entity_id: 1 });
workLogSchema.index({ tenant_id: 1, user_id: 1 });
workLogSchema.index({ tenant_id: 1, status: 1 });
workLogSchema.index({ tenant_id: 1, logged_at: 1, source: 1 });
workLogSchema.index({ tenant_id: 1, source_work_log_id: 1 }, { unique: true, partialFilterExpression: { source_work_log_id: { $exists: true } } });

export const WorkLog: Model<WorkLogDocument> = mongoose.model<WorkLogDocument>('WorkLog', workLogSchema);
