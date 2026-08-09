import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IAffectedComponent {
  component_id: Types.ObjectId;
  name: string;
  status_before: string;
  status_after: string;
}

export interface IStatusUpdate {
  tenant_id: Types.ObjectId;
  status_page_id: Types.ObjectId;
  title: string;
  body: string;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'informational';
  visibility: 'public' | 'internal';
  affected_components: IAffectedComponent[];
  created_by: Types.ObjectId;
  notify_subscribers: boolean;
  postmortem_id?: Types.ObjectId;
  incident_id?: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

export interface StatusUpdateDocument extends IStatusUpdate, Document {
  _id: Types.ObjectId;
}

const statusUpdateSchema = new Schema<StatusUpdateDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    status_page_id: { type: Schema.Types.ObjectId, ref: 'StatusPage', required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    body: { type: String, default: '', maxlength: 5000 },
    status: {
      type: String,
      enum: ['investigating', 'identified', 'monitoring', 'resolved', 'informational'],
      required: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'internal'],
      default: 'public',
    },
    affected_components: [
      {
        component_id: { type: Schema.Types.ObjectId },
        name: { type: String, required: true },
        status_before: { type: String, default: '' },
        status_after: { type: String, default: '' },
      },
    ],
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notify_subscribers: { type: Boolean, default: false },
    postmortem_id: { type: Schema.Types.ObjectId, ref: 'Postmortem', default: null },
    incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
  },
  {
    collection: 'status_updates',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

statusUpdateSchema.index({ status_page_id: 1, created_at: -1 });
statusUpdateSchema.index({ tenant_id: 1 });

export const StatusUpdate: Model<StatusUpdateDocument> = mongoose.model<StatusUpdateDocument>(
  'StatusUpdate',
  statusUpdateSchema
);
