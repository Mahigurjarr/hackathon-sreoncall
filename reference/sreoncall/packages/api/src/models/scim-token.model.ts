import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IScimToken {
  tenant_id: Types.ObjectId;
  name: string;
  token_hash: string;
  token_prefix: string;
  last_used_at?: Date;
  expires_at?: Date;
  created_by: Types.ObjectId;
  revoked_at?: Date;
}

export interface ScimTokenDocument extends IScimToken, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const scimTokenSchema = new Schema<ScimTokenDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    token_hash: { type: String, required: true },
    token_prefix: { type: String, required: true },
    last_used_at: Date,
    expires_at: Date,
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    revoked_at: Date,
  },
  {
    collection: 'scim_tokens',
    timestamps: true,
  }
);

scimTokenSchema.index({ token_hash: 1 }, { unique: true });
scimTokenSchema.index({ tenant_id: 1 });

export const ScimToken: Model<ScimTokenDocument> = mongoose.model<ScimTokenDocument>('ScimToken', scimTokenSchema);
