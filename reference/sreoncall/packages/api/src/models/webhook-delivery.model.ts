import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IWebhookDelivery {
  tenant_id: Types.ObjectId;
  webhook_id: Types.ObjectId;
  event_type: string;
  payload: Record<string, any>;
  status: 'pending' | 'success' | 'failed' | 'dead_letter';
  attempts: number;
  max_attempts: number;
  last_attempt_at?: Date;
  next_retry_at?: Date;
  response_status?: number;
  response_body?: string;
  error_message?: string;
}

export interface WebhookDeliveryDocument extends IWebhookDelivery, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const webhookDeliverySchema = new Schema<WebhookDeliveryDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    webhook_id: { type: Schema.Types.ObjectId, ref: 'Webhook', required: true },
    event_type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'dead_letter'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    max_attempts: { type: Number, default: 6 },
    last_attempt_at: Date,
    next_retry_at: Date,
    response_status: Number,
    response_body: { type: String, maxlength: 10000 },
    error_message: String,
  },
  {
    timestamps: true,
    collection: 'webhook_deliveries',
  }
);

webhookDeliverySchema.index({ tenant_id: 1, webhook_id: 1, createdAt: -1 });
webhookDeliverySchema.index({ status: 1, next_retry_at: 1 });
// TTL: auto-delete webhook deliveries older than 30 days
webhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const WebhookDelivery: Model<WebhookDeliveryDocument> = mongoose.model<WebhookDeliveryDocument>(
  'WebhookDelivery',
  webhookDeliverySchema
);
