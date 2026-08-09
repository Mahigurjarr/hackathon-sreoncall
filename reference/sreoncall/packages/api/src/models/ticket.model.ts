import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface AiSuggestion {
  category_suggestion?: string;
  priority_suggestion?: string;
  duplicate_of_id?: Types.ObjectId;
}

export interface IWorkLog {
  _id: Types.ObjectId;
  user_id: Types.ObjectId;
  minutes: number;
  description?: string;
  logged_at: Date;
  created_at: Date;
}

export interface ITicketSla {
  config_id: Types.ObjectId | null;
  response_deadline: Date | null;
  resolution_deadline: Date | null;
  response_met: boolean | null;
  resolution_met: boolean | null;
  first_response_at: Date | null;
  paused_at: Date | null;
  paused_duration_ms: number;
}

export interface ITicket {
  tenant_id: Types.ObjectId;
  project_id: Types.ObjectId;
  number: number;
  type: 'epic' | 'user_story' | 'task' | 'bug';
  title: string;
  description?: string;
  status: string;
  priority: 'high' | 'medium' | 'low';
  assignee_id?: Types.ObjectId;
  team_id?: Types.ObjectId;
  reporter_id: Types.ObjectId;
  labels: string[];
  custom_fields: Map<string, any>;
  parent_id?: Types.ObjectId;
  related_ids: Types.ObjectId[];
  blocks_ids: Types.ObjectId[];
  blocked_by_ids: Types.ObjectId[];
  linked_incident_ids: Types.ObjectId[];
  linked_change_request_ids: Types.ObjectId[];
  milestone_id?: Types.ObjectId;
  sprint_id?: Types.ObjectId | null;
  is_backlog: boolean;
  ai: AiSuggestion;
  watcher_ids: Types.ObjectId[];
  time_estimate_raw?: string;
  time_estimate_minutes?: number | null;
  time_spent_minutes: number;
  work_logs: IWorkLog[];
  sla?: ITicketSla;
  resolved_at?: Date;
  deleted_at?: Date;
}

export interface TicketDocument extends ITicket, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const workLogSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    minutes: { type: Number, required: true, min: 1 },
    description: { type: String, maxlength: 2000 },
    logged_at: { type: Date, default: Date.now },
    created_at: { type: Date, default: Date.now },
  },
);

const aiSchema = new Schema<AiSuggestion>(
  {
    category_suggestion: String,
    priority_suggestion: { type: String, enum: ['high', 'medium', 'low'] },
    duplicate_of_id: { type: Schema.Types.ObjectId, ref: 'Ticket' },
  },
  { _id: false }
);

const slaSchema = new Schema<ITicketSla>(
  {
    config_id: { type: Schema.Types.ObjectId, ref: 'SlaConfig', default: null },
    response_deadline: { type: Date, default: null },
    resolution_deadline: { type: Date, default: null },
    response_met: { type: Boolean, default: null },
    resolution_met: { type: Boolean, default: null },
    first_response_at: { type: Date, default: null },
    paused_at: { type: Date, default: null },
    paused_duration_ms: { type: Number, default: 0 },
  },
  { _id: false }
);

const ticketSchema = new Schema<TicketDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    project_id: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    number: { type: Number, required: true },
    type: {
      type: String,
      enum: ['epic', 'user_story', 'task', 'bug'],
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 500 },
    description: { type: String, maxlength: 50000 },
    status: { type: String, required: true, default: 'open' },
    priority: { type: String, enum: ['high', 'medium', 'low'], required: true, default: 'medium' },
    assignee_id: { type: Schema.Types.ObjectId, ref: 'User' },
    team_id: { type: Schema.Types.ObjectId, ref: 'Team' },
    reporter_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    labels: [{ type: String, trim: true }],
    custom_fields: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    parent_id: { type: Schema.Types.ObjectId, ref: 'Ticket' },
    related_ids: [{ type: Schema.Types.ObjectId, ref: 'Ticket' }],
    blocks_ids: [{ type: Schema.Types.ObjectId, ref: 'Ticket' }],
    blocked_by_ids: [{ type: Schema.Types.ObjectId, ref: 'Ticket' }],
    linked_incident_ids: [{ type: Schema.Types.ObjectId, ref: 'Incident' }],
    linked_change_request_ids: [{ type: Schema.Types.ObjectId, ref: 'ChangeRequest' }],
    milestone_id: { type: Schema.Types.ObjectId, ref: 'Milestone', index: true },
    sprint_id:    { type: Schema.Types.ObjectId, ref: 'Sprint', index: true, default: null },
    is_backlog:   { type: Boolean, default: false, index: true },
    ai: { type: aiSchema, default: () => ({}) },
    watcher_ids: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    time_estimate_raw: { type: String },
    time_estimate_minutes: { type: Number, default: null },
    time_spent_minutes: { type: Number, default: 0 },
    work_logs: { type: [workLogSchema], default: [] },
    sla: { type: slaSchema, default: undefined },
    resolved_at: Date,
    deleted_at: Date,
  },
  {
    timestamps: true,
    collection: 'tickets',
  }
);

ticketSchema.index({ tenant_id: 1, status: 1 });
ticketSchema.index({ tenant_id: 1, priority: 1, updatedAt: -1 });
ticketSchema.index({ tenant_id: 1, number: 1 }, { unique: true });
ticketSchema.index({ tenant_id: 1, assignee_id: 1 });
ticketSchema.index({ tenant_id: 1, team_id: 1 });
ticketSchema.index({ tenant_id: 1, project_id: 1 });
ticketSchema.index({ tenant_id: 1, 'sla.resolution_deadline': 1 });
ticketSchema.index({ tenant_id: 1, milestone_id: 1 });
ticketSchema.index({ tenant_id: 1, sprint_id: 1 });
ticketSchema.index({ tenant_id: 1, is_backlog: 1 });

// Soft delete filter
ticketSchema.pre('find', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

ticketSchema.pre('findOne', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

export const Ticket: Model<TicketDocument> = mongoose.model<TicketDocument>('Ticket', ticketSchema);
