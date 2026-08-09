import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IFreezeWindow {
  tenant_id: Types.ObjectId;
  name: string;
  description: string;
  start: Date;
  end: Date;
  /** Empty = applies to all services (a platform-wide freeze, e.g. holiday code freeze). */
  service_ids: Types.ObjectId[];
  created_by: Types.ObjectId;
}

export interface FreezeWindowDocument extends IFreezeWindow, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const freezeWindowSchema = new Schema<FreezeWindowDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 2000 },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    service_ids: [{ type: Schema.Types.ObjectId, ref: 'Service' }],
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    collection: 'freeze_windows',
  },
);

freezeWindowSchema.index({ tenant_id: 1, start: 1, end: 1 });

export const FreezeWindow: Model<FreezeWindowDocument> = mongoose.model<FreezeWindowDocument>(
  'FreezeWindow',
  freezeWindowSchema,
);
