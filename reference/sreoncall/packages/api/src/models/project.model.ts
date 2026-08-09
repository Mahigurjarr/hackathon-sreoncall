import mongoose, { Document, Schema } from 'mongoose';

export interface IProject extends Document {
  tenant_id: Schema.Types.ObjectId;
  name: string;
  // Short uppercase code (e.g. "INFRA") used to prefix ticket numbers
  // (INFRA-0411) and label the project on cards, so tickets are identifiable
  // across cross-project views. Unique per tenant.
  key: string;
  // Hex accent color for the project chip/dot.
  color: string;
  description: string;
  visibility: 'org' | 'private';
  created_by: Schema.Types.ObjectId;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const projectSchema = new Schema<IProject>(
  {
    tenant_id: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    key: { type: String, trim: true, uppercase: true, maxlength: 8 },
    color: { type: String, default: '#2563EB' },
    description: { type: String, default: '', maxlength: 2000 },
    visibility: { type: String, enum: ['org', 'private'], default: 'org' },
    deleted_at: { type: Date, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

projectSchema.index({ tenant_id: 1, name: 1 });
// Unique per tenant, but only enforced once a key is set (partial filter) so
// legacy projects without a key don't collide before the backfill migration.
projectSchema.index(
  { tenant_id: 1, key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } } },
);

// Soft-delete pre-find hooks
projectSchema.pre('find', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

projectSchema.pre('findOne', function () {
  if (!(this.getFilter() as any).deleted_at) {
    this.where({ deleted_at: { $eq: null } });
  }
});

export const Project = mongoose.model<IProject>('Project', projectSchema);
