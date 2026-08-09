import mongoose, { Schema, Document, Model, Types } from 'mongoose';

/**
 * A user's calendar connected to Recall.ai's Calendar V2 for auto-capture.
 * We run the Google/Microsoft OAuth ourselves, store the (encrypted) refresh
 * token, and register the calendar with Recall (which then syncs events and
 * sends us `calendar.sync_events` webhooks). We only auto-dispatch bots to
 * meetings matched to an incident/war room — never record-all.
 */
export type CalendarPlatform = 'google' | 'microsoft';
export type CalendarConnectionStatus = 'connected' | 'disconnected' | 'error';

export interface ICalendarConnection {
  tenant_id: Types.ObjectId;
  user_id: Types.ObjectId;
  platform: CalendarPlatform;
  email: string;
  /** Recall.ai calendar id returned by POST /calendars/. */
  recall_calendar_id: string;
  status: CalendarConnectionStatus;
  error?: string | null;
  /** OAuth refresh token, encrypted at rest (utils/encryption). */
  refresh_token_encrypted: string;
  /** Watermark for incremental event sync (from calendar.sync_events). */
  last_synced_at?: Date | null;
  created_by: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export interface CalendarConnectionDocument extends ICalendarConnection, Document {
  _id: Types.ObjectId;
}

const calendarConnectionSchema = new Schema<CalendarConnectionDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: ['google', 'microsoft'], required: true },
    email: { type: String, default: '', maxlength: 320 },
    recall_calendar_id: { type: String, required: true },
    status: { type: String, enum: ['connected', 'disconnected', 'error'], default: 'connected' },
    error: { type: String, default: null },
    refresh_token_encrypted: { type: String, required: true },
    last_synced_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    collection: 'calendar_connections',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// One connection per user+platform+email per tenant.
calendarConnectionSchema.index(
  { tenant_id: 1, user_id: 1, platform: 1, email: 1 },
  { unique: true }
);
// Fast lookup from the Recall calendar webhook (calendar_id → tenant/user).
calendarConnectionSchema.index({ recall_calendar_id: 1 });

export const CalendarConnection: Model<CalendarConnectionDocument> =
  mongoose.model<CalendarConnectionDocument>('CalendarConnection', calendarConnectionSchema);
