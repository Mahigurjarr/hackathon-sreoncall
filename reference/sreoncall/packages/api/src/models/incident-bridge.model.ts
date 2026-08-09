import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IIncidentBridge {
  consumer_tenant_id: Types.ObjectId;
  consumer_incident_id: Types.ObjectId;
  provider_tenant_id: Types.ObjectId;
  provider_incident_id: Types.ObjectId;
  status: 'active' | 'resolved' | 'expired';
  escalated_at: Date;
  resolved_at: Date | null;
}

export interface IncidentBridgeDocument extends IIncidentBridge, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const incidentBridgeSchema = new Schema<IncidentBridgeDocument>(
  {
    consumer_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    consumer_incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    provider_tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    provider_incident_id: { type: Schema.Types.ObjectId, ref: 'Incident', required: true },
    status: {
      type: String,
      enum: ['active', 'resolved', 'expired'],
      default: 'active',
    },
    escalated_at: { type: Date, default: () => new Date() },
    resolved_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'incident-bridges',
  }
);

incidentBridgeSchema.index({ consumer_incident_id: 1 }, { unique: true });
incidentBridgeSchema.index({ provider_incident_id: 1 });
incidentBridgeSchema.index({ provider_tenant_id: 1, status: 1 });

export const IncidentBridge: Model<IncidentBridgeDocument> = mongoose.model<IncidentBridgeDocument>(
  'IncidentBridge',
  incidentBridgeSchema
);
