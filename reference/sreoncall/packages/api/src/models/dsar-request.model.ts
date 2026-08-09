import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type DsarType = 'access' | 'erasure' | 'rectification' | 'portability';
export type DsarStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface IDsarRequest {
  tenant_id: Types.ObjectId;
  user_id: Types.ObjectId;
  type: DsarType;
  status: DsarStatus;
  requested_at: Date;
  completed_at?: Date;
  download_url?: string;
  download_expires_at?: Date;
  notes?: string;
}

export interface DsarRequestDocument extends IDsarRequest, Document {
  _id: Types.ObjectId;
}

const dsarRequestSchema = new Schema<DsarRequestDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['access', 'erasure', 'rectification', 'portability'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    requested_at: { type: Date, required: true, default: Date.now },
    completed_at: { type: Date },
    download_url: { type: String },
    download_expires_at: { type: Date },
    notes: { type: String },
  },
  {
    collection: 'dsar_requests',
    timestamps: false,
  }
);

dsarRequestSchema.index({ tenant_id: 1, user_id: 1, requested_at: -1 });
dsarRequestSchema.index({ status: 1 });
// TTL: auto-cleanup expired download URLs
dsarRequestSchema.index({ download_expires_at: 1 }, { expireAfterSeconds: 0, sparse: true });

export const DsarRequest: Model<DsarRequestDocument> = mongoose.model<DsarRequestDocument>(
  'DsarRequest',
  dsarRequestSchema
);
