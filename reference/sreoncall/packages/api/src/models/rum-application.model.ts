import mongoose, { Document, Model, Schema, Types } from 'mongoose';

export interface IRumApplication {
  tenant_id: Types.ObjectId;
  slug: string;
  display_name: string;
  status: 'active';
  created_at: Date;
  updated_at: Date;
}

export interface RumApplicationDocument extends IRumApplication, Document {
  _id: Types.ObjectId;
}

const rumApplicationSchema = new Schema<RumApplicationDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 1,
      maxlength: 80,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    display_name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    status: {
      type: String,
      enum: ['active'],
      default: 'active',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'rum-applications',
  },
);

rumApplicationSchema.index({ tenant_id: 1, slug: 1 }, { unique: true });

export const RumApplication: Model<RumApplicationDocument> = mongoose.model<RumApplicationDocument>(
  'RumApplication',
  rumApplicationSchema,
);
