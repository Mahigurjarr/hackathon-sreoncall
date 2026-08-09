import mongoose, { Document, Schema } from 'mongoose';

export interface IIngestionToken extends Document {
  tenant_id: Schema.Types.ObjectId;
  name: string;
  token_hash: string;
  scopes: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_by: Schema.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const S = new Schema<IIngestionToken>(
  {
    tenant_id:   { type: Schema.Types.ObjectId, required: true, index: true },
    name:        { type: String, required: true },
    token_hash:  { type: String, required: true },
    scopes:      [{ type: String, enum: ['metrics:write', 'logs:write', 'traces:write', 'traps:write'] }],
    last_used_at:{ type: Date, default: null },
    expires_at:  { type: Date, default: null },
    revoked_at:  { type: Date, default: null },
    created_by:  { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, revoked_at: 1 });

export const IngestionToken = mongoose.model<IIngestionToken>('IngestionToken', S, 'ingestion_tokens');
