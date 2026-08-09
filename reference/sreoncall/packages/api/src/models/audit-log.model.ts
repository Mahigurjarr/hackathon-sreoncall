import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface AuditActor {
  type: 'user' | 'system' | 'api_key' | 'impersonated';
  id?: Types.ObjectId;
  email?: string;
  ip: string;
  user_agent: string;
  impersonated_by?: string;
}

export interface AuditChange {
  field: string;
  old_value: any;
  new_value: any;
}

export interface IAuditLog {
  tenant_id: Types.ObjectId;
  timestamp: Date;
  actor: AuditActor;
  action: string;
  resource_type: string;
  resource_id?: string;
  changes: AuditChange[];
  result: 'success' | 'failure';
  request_id?: string;
  expires_at?: Date;
}

export interface AuditLogDocument extends IAuditLog, Document {
  _id: Types.ObjectId;
}

const auditActorSchema = new Schema<AuditActor>(
  {
    type: { type: String, enum: ['user', 'system', 'api_key', 'impersonated'], required: true },
    id: { type: Schema.Types.ObjectId },
    email: String,
    ip: { type: String, required: true },
    user_agent: { type: String, required: true },
    impersonated_by: String,
  },
  { _id: false }
);

const auditChangeSchema = new Schema<AuditChange>(
  {
    field: { type: String, required: true },
    old_value: Schema.Types.Mixed,
    new_value: Schema.Types.Mixed,
  },
  { _id: false }
);

const auditLogSchema = new Schema<AuditLogDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    timestamp: { type: Date, required: true, default: Date.now },
    actor: { type: auditActorSchema, required: true },
    action: { type: String, required: true },
    resource_type: { type: String, required: true },
    resource_id: String,
    changes: [auditChangeSchema],
    result: { type: String, enum: ['success', 'failure'], required: true },
    request_id: String,
    expires_at: Date,
  },
  {
    collection: 'audit_logs',
    timestamps: false,
  }
);

auditLogSchema.index({ tenant_id: 1, timestamp: -1 });
auditLogSchema.index({ tenant_id: 1, resource_type: 1, resource_id: 1 });
// TTL index: auto-delete expired audit logs
auditLogSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0, sparse: true });

export const AuditLog: Model<AuditLogDocument> = mongoose.model<AuditLogDocument>('AuditLog', auditLogSchema);
