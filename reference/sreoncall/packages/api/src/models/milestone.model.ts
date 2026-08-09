import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export interface IMilestone {
  tenant_id: Types.ObjectId;
  project_id: Types.ObjectId | null;
  name: string;
  description: string;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  start_date: Date;
  target_date: Date;
  completed_at: Date | null;
  created_by: Types.ObjectId;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface MilestoneDocument extends IMilestone, Document {
  _id: Types.ObjectId;
}

const milestoneSchema = new Schema<MilestoneDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, required: true, index: true },
    project_id: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    status: {
      type: String,
      enum: ['planned', 'active', 'completed', 'cancelled'],
      default: 'planned',
    },
    start_date: { type: Date, required: true },
    target_date: { type: Date, required: true },
    completed_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
    deleted_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

milestoneSchema.index({ tenant_id: 1, project_id: 1 });
milestoneSchema.index({ tenant_id: 1, status: 1 });
milestoneSchema.index({ tenant_id: 1, target_date: 1 });

// Soft-delete pre-find hooks
milestoneSchema.pre('find', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

milestoneSchema.pre('findOne', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

export const Milestone: Model<MilestoneDocument> = mongoose.model<MilestoneDocument>('Milestone', milestoneSchema);
