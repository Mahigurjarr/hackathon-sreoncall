import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export interface ISprint {
  tenant_id: Types.ObjectId;
  project_id?: Types.ObjectId | null;
  name: string;
  goal: string;
  status: 'planning' | 'active' | 'completed';
  start_date: Date;
  end_date: Date;
  completed_at: Date | null;
  created_by: Types.ObjectId;
  deleted_at: Date | null;
}

export interface SprintDocument extends ISprint, Document {
  _id: Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const sprintSchema = new Schema<SprintDocument>(
  {
    tenant_id:    { type: Schema.Types.ObjectId, required: true, index: true },
    project_id:   { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    name:         { type: String, required: true, trim: true, maxlength: 200 },
    goal:         { type: String, default: '', maxlength: 2000 },
    status:       { type: String, enum: ['planning', 'active', 'completed'], default: 'planning' },
    start_date:   { type: Date, required: true },
    end_date:     { type: Date, required: true },
    completed_at: { type: Date, default: null },
    created_by:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deleted_at:   { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'sprints',
  }
);

sprintSchema.index({ tenant_id: 1, project_id: 1 });
sprintSchema.index({ tenant_id: 1, status: 1 });

sprintSchema.pre('find', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

sprintSchema.pre('findOne', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

export const Sprint: Model<SprintDocument> = mongoose.model<SprintDocument>('Sprint', sprintSchema);
