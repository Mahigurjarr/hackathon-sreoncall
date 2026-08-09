import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IApiKey {
  tenant_id: Types.ObjectId;
  name: string;
  key_hash: string;
  key_prefix: string;
  permissions: string[];
  last_used_at?: Date;
  expires_at?: Date;
  created_by: Types.ObjectId;
  created_at: Date;
  revoked_at?: Date;
}

export interface ApiKeyDocument extends IApiKey, Document {
  _id: Types.ObjectId;
}

const apiKeySchema = new Schema<ApiKeyDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    key_hash: { type: String, required: true },
    key_prefix: { type: String, required: true },
    permissions: [{ type: String }],
    last_used_at: Date,
    expires_at: Date,
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    created_at: { type: Date, default: Date.now },
    revoked_at: Date,
  },
  {
    collection: 'api_keys',
    timestamps: false,
  }
);

apiKeySchema.index({ key_hash: 1 }, { unique: true });
apiKeySchema.index({ tenant_id: 1 });

export const ApiKey: Model<ApiKeyDocument> = mongoose.model<ApiKeyDocument>('ApiKey', apiKeySchema);
