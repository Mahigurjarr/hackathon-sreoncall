import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IDashboardPanel {
  id: string;
  title: string;
  type: 'line_chart' | 'bar_chart' | 'gauge' | 'stat' | 'table' | 'heatmap' | 'log_viewer' | 'trace_waterfall';
  grid: { x: number; y: number; w: number; h: number };
  data_source: {
    type: 'managed' | 'byos';
    provider: string | null;
    service_id: Types.ObjectId | null;
  };
  query: string;
  options: Record<string, unknown>;
  thresholds: Array<{ value: number; color: string }>;
}

export interface IDashboardVariable {
  name: string;
  label: string;
  type: 'query' | 'custom';
  // For type='query': { label_name } → values fetched from /metrics/label/:name/values
  // For type='custom': { values: string[] } → static list
  source: { label_name?: string; values?: string[]; match_template?: string };
  default: string[];
  multi: boolean;
}

export interface IDashboard {
  tenant_id: Types.ObjectId;
  name: string;
  description: string;
  is_template: boolean;
  is_public: boolean;
  share_token: string | null;
  source_template_id: string | null;
  hide_scope: boolean;
  default_time_range: string;
  panels: IDashboardPanel[];
  variables: IDashboardVariable[];
  time_range: { from: string; to: string };
  refresh_interval_seconds: number;
  tags: string[];
  created_by: Types.ObjectId;
}

export interface DashboardDocument extends IDashboard, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const panelSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ['line_chart', 'bar_chart', 'gauge', 'stat', 'table', 'heatmap', 'log_viewer', 'trace_waterfall'],
      required: true,
    },
    grid: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      w: { type: Number, default: 6 },
      h: { type: Number, default: 4 },
    },
    data_source: {
      type: { type: String, enum: ['managed', 'byos'], default: 'managed' },
      provider: { type: String, default: null },
      service_id: { type: Schema.Types.ObjectId, default: null },
    },
    query: { type: String, default: '' },
    options: { type: Schema.Types.Mixed, default: {} },
    thresholds: [
      {
        value: { type: Number, required: true },
        color: { type: String, required: true },
      },
    ],
  },
  { _id: false },
);

const variableSchema = new Schema(
  {
    name: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['query', 'custom'], required: true },
    source: {
      label_name: { type: String, default: null },
      values: { type: [String], default: undefined },
      match_template: { type: String, default: null },
    },
    default: { type: [String], default: [] },
    multi: { type: Boolean, default: false },
  },
  { _id: false },
);

const dashboardSchema = new Schema<DashboardDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 2000 },
    is_template: { type: Boolean, default: false },
    is_public: { type: Boolean, default: false },
    share_token: { type: String, default: null },
    panels: { type: [panelSchema], default: [] },
    variables: { type: [variableSchema], default: [] },
    time_range: {
      from: { type: String, default: 'now-1h' },
      to: { type: String, default: 'now' },
    },
    refresh_interval_seconds: { type: Number, default: 30 },
    tags: [{ type: String, trim: true }],
    source_template_id: { type: String, default: null },
    hide_scope: { type: Boolean, default: false },
    default_time_range: { type: String, default: 'now-24h' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'dashboards',
  },
);

dashboardSchema.index({ tenant_id: 1, createdAt: -1 });
dashboardSchema.index({ tenant_id: 1, is_template: 1 });
dashboardSchema.index({ tenant_id: 1, source_template_id: 1 });

export const Dashboard: Model<DashboardDocument> = mongoose.model<DashboardDocument>('Dashboard', dashboardSchema);
