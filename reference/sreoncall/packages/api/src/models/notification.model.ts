import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface INotification {
  tenant_id: Types.ObjectId;
  user_id: Types.ObjectId;
  type: string;
  priority: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  resource_type?: string;
  resource_id?: string;
  read: boolean;
  read_at?: Date;
  archived: boolean;
  delivered_channels: string[];
  created_at: Date;
}

export interface NotificationDocument extends INotification, Document {
  _id: Types.ObjectId;
}

const notificationSchema = new Schema<NotificationDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    priority: {
      type: String,
      enum: ['info', 'warning', 'error', 'critical'],
      default: 'info',
    },
    title: { type: String, required: true, maxlength: 500 },
    body: { type: String, required: true, maxlength: 5000 },
    resource_type: String,
    resource_id: String,
    read: { type: Boolean, default: false },
    read_at: Date,
    archived: { type: Boolean, default: false },
    delivered_channels: { type: [String], default: ['in_app'] },
    created_at: { type: Date, default: Date.now },
  },
  {
    collection: 'notifications',
    timestamps: false,
  }
);

// Existing: primary query index
notificationSchema.index({ tenant_id: 1, user_id: 1, read: 1, created_at: -1 });

// TTL: auto-purge notifications older than 90 days
notificationSchema.index({ created_at: 1 }, { expireAfterSeconds: 7776000 });

// Type filtering
notificationSchema.index({ tenant_id: 1, user_id: 1, type: 1, created_at: -1 });

// Resource cleanup lookups
notificationSchema.index({ tenant_id: 1, resource_type: 1, resource_id: 1 });

export const Notification: Model<NotificationDocument> = mongoose.model<NotificationDocument>(
  'Notification',
  notificationSchema
);
