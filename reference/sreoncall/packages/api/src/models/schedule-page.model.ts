import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type SchedulePageStatus =
  | 'active'        // currently waiting on the current layer's user(s) to ack
  | 'acknowledged'  // a user (commonly the paged one) acknowledged the incident
  | 'resolved'      // incident was resolved before paging finished
  | 'completed'     // last layer reached and its timeout passed (or had no timeout)
  | 'canceled';     // tier moved on, or operator-initiated cancel

export type SchedulePageReason =
  | 'initial'
  | 'no_ack_timeout'
  | 'no_user_for_layer'
  | 'override'
  | 'manual';

export interface ISchedulePageHistoryEntry {
  layer_index: number;
  layer_id: string | null;
  user_id: Types.ObjectId | null;
  started_at: Date;
  ended_at: Date | null;
  reason: SchedulePageReason;
}

export interface ISchedulePage {
  tenant_id: Types.ObjectId;
  schedule_id: Types.ObjectId;
  incident_id: Types.ObjectId;
  /**
   * If the page was kicked off by a managed-support tier (L1/L2/L3), the
   * tier the page belongs to. Lets the SLA worker scope cancellations
   * to a specific tier when escalating.
   */
  tier_level: 1 | 2 | 3 | null;
  /**
   * Index into schedule.layers[] of the layer currently being paged.
   * Overrides take precedence over layers; when an override fires we
   * record current_layer_index = -1.
   */
  current_layer_index: number;
  current_layer_id: string | null;
  current_user_id: Types.ObjectId | null;
  layer_started_at: Date;
  /** When the worker should promote to the next layer. `null` if no escalation. */
  layer_deadline: Date | null;
  status: SchedulePageStatus;
  history: ISchedulePageHistoryEntry[];
  started_at: Date;
}

export interface SchedulePageDocument extends ISchedulePage, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const historySchema = new Schema<ISchedulePageHistoryEntry>(
  {
    layer_index: { type: Number, required: true },
    layer_id: { type: String, default: null },
    user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    started_at: { type: Date, required: true },
    ended_at: { type: Date, default: null },
    reason: {
      type: String,
      enum: ['initial', 'no_ack_timeout', 'no_user_for_layer', 'override', 'manual'],
      required: true,
    },
  },
  { _id: false }
);

const schedulePageSchema = new Schema<SchedulePageDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    schedule_id: { type: Schema.Types.ObjectId, ref: 'OnCallSchedule', required: true },
    incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    tier_level: { type: Number, enum: [1, 2, 3, null], default: null },
    current_layer_index: { type: Number, required: true },
    current_layer_id: { type: String, default: null },
    current_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    layer_started_at: { type: Date, required: true },
    layer_deadline: { type: Date, default: null },
    status: {
      type: String,
      enum: ['active', 'acknowledged', 'resolved', 'completed', 'canceled'],
      default: 'active',
    },
    history: { type: [historySchema], default: [] },
    started_at: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'schedule_pages',
  }
);

// Worker scan index: find active pages whose layer deadline has passed.
schedulePageSchema.index({ status: 1, layer_deadline: 1 });
// Cancel-on-ack/resolve lookup.
schedulePageSchema.index({ incident_id: 1, status: 1 });
// Per-tenant listing.
schedulePageSchema.index({ tenant_id: 1, status: 1 });

export const SchedulePage: Model<SchedulePageDocument> = mongoose.model<SchedulePageDocument>(
  'SchedulePage',
  schedulePageSchema
);
