import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IWebhook {
  tenant_id: Types.ObjectId;
  url: string;
  description: string;
  secret_hash: string;
  secret_prefix: string;
  events: string[];
  active: boolean;
  last_triggered_at?: Date;
  delivery_stats: { success: number; failed: number };
  created_at: Date;
  updated_at: Date;
}

export interface WebhookDocument extends IWebhook, Document {
  _id: Types.ObjectId;
}

const webhookSchema = new Schema<WebhookDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    url: { type: String, required: true, maxlength: 2000 },
    description: { type: String, default: '', maxlength: 500 },
    secret_hash: { type: String, required: true },
    secret_prefix: { type: String, required: true },
    events: [{ type: String }],
    active: { type: Boolean, default: true },
    last_triggered_at: Date,
    delivery_stats: {
      success: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
  },
  {
    collection: 'webhooks',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

webhookSchema.index({ tenant_id: 1 });

export const Webhook: Model<WebhookDocument> = mongoose.model<WebhookDocument>(
  'Webhook',
  webhookSchema
);
