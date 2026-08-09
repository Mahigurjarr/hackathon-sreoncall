import mongoose, { Schema, Document, Model, Types } from 'mongoose';

/**
 * Optional per-tenant "bring your own" calendar OAuth app credentials. When a
 * tenant has an active config for a platform, it overrides the platform-owned
 * (global env) OAuth app for that tenant's calendar connections — giving
 * enterprises their own OAuth app (data governance, no shared Google-verification
 * dependency). When absent, the global default is used.
 */
export type CalendarOAuthPlatform = 'google' | 'microsoft';

export interface ICalendarOAuthConfig {
  tenant_id: Types.ObjectId;
  platform: CalendarOAuthPlatform;
  client_id: string;
  client_secret_encrypted: string;
  /** Microsoft only: 'common' (multitenant) or a specific tenant id. */
  microsoft_tenant?: string | null;
  is_active: boolean;
  created_by: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export interface CalendarOAuthConfigDocument extends ICalendarOAuthConfig, Document {
  _id: Types.ObjectId;
}

const schema = new Schema<CalendarOAuthConfigDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    platform: { type: String, enum: ['google', 'microsoft'], required: true },
    client_id: { type: String, required: true },
    client_secret_encrypted: { type: String, required: true },
    microsoft_tenant: { type: String, default: null },
    is_active: { type: Boolean, default: true },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'calendar_oauth_configs',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

schema.index({ tenant_id: 1, platform: 1 }, { unique: true });

export const CalendarOAuthConfig: Model<CalendarOAuthConfigDocument> =
  mongoose.model<CalendarOAuthConfigDocument>('CalendarOAuthConfig', schema);
