import mongoose, { Document, Schema } from 'mongoose';

export interface ISyntheticCheckResult extends Document {
  check_id: Schema.Types.ObjectId;
  tenant_id: Schema.Types.ObjectId;
  status: 'up' | 'down' | 'degraded';
  response_time_ms: number | null;
  error: string | null;
  http_status_code: number | null;
  ssl_issuer: string | null;
  ssl_valid_from: Date | null;
  ssl_valid_to: Date | null;
  ssl_days_remaining: number | null;
  checked_at: Date;
}

const S = new Schema<ISyntheticCheckResult>(
  {
    check_id:          { type: Schema.Types.ObjectId, required: true, index: true },
    tenant_id:         { type: Schema.Types.ObjectId, required: true, index: true },
    status:            { type: String, enum: ['up', 'down', 'degraded'], required: true },
    response_time_ms:  { type: Number, default: null },
    error:             { type: String, default: null },
    http_status_code:  { type: Number, default: null },
    ssl_issuer:        { type: String, default: null },
    ssl_valid_from:    { type: Date, default: null },
    ssl_valid_to:      { type: Date, default: null },
    ssl_days_remaining: { type: Number, default: null },
    checked_at:        { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// TTL: auto-delete results older than 30 days
S.index({ checked_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
S.index({ check_id: 1, checked_at: -1 });

export const SyntheticCheckResult = mongoose.model<ISyntheticCheckResult>('SyntheticCheckResult', S);
