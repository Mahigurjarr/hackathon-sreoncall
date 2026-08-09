import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface EdgeSnapshot {
  source_service_id: Types.ObjectId;
  source_service_name: string;
  target_service_id: Types.ObjectId;
  target_service_name: string;
  dependency_type: string;
  criticality: string;
}

export interface IServiceMapVersion {
  tenant_id: Types.ObjectId;
  version: number;
  snapshot: EdgeSnapshot[];
  created_by: Types.ObjectId;
  change_summary: string | null;
  incident_id: Types.ObjectId | null;
}

export interface ServiceMapVersionDocument extends IServiceMapVersion, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const edgeSnapshotSchema = new Schema<EdgeSnapshot>(
  {
    source_service_id: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    source_service_name: { type: String, required: true },
    target_service_id: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    target_service_name: { type: String, required: true },
    dependency_type: { type: String, required: true },
    criticality: { type: String, required: true },
  },
  { _id: false }
);

const serviceMapVersionSchema = new Schema<ServiceMapVersionDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    version: { type: Number, required: true },
    snapshot: [edgeSnapshotSchema],
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    change_summary: { type: String, default: null },
    incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', default: null },
  },
  {
    timestamps: true,
    collection: 'service_map_versions',
  }
);

serviceMapVersionSchema.index({ tenant_id: 1, version: -1 });
serviceMapVersionSchema.index({ tenant_id: 1, incident_id: 1 });

export const ServiceMapVersion: Model<ServiceMapVersionDocument> = mongoose.model<ServiceMapVersionDocument>(
  'ServiceMapVersion',
  serviceMapVersionSchema
);
