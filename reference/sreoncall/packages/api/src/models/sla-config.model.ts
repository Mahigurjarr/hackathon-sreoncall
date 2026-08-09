import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface BusinessHours {
  timezone: string;
  schedule: Array<{
    day: number; // 0 = Sunday, 6 = Saturday
    start: string; // HH:mm
    end: string; // HH:mm
  }>;
  holidays: Array<{
    date: string; // YYYY-MM-DD
    name: string;
  }>;
}

export interface SlaConditions {
  priority: number[];
  ticket_types: string[];
}

export interface ISlaConfig {
  tenant_id: Types.ObjectId;
  name: string;
  conditions: SlaConditions;
  response_time_minutes: number;
  resolution_time_minutes: number;
  business_hours?: BusinessHours;
  enabled: boolean;
}

export interface SlaConfigDocument extends ISlaConfig, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const businessHoursSchema = new Schema<BusinessHours>(
  {
    timezone: { type: String, required: true, default: 'UTC' },
    schedule: [
      {
        day: { type: Number, min: 0, max: 6, required: true },
        start: { type: String, required: true },
        end: { type: String, required: true },
      },
    ],
    holidays: [
      {
        date: { type: String, required: true },
        name: { type: String, required: true },
      },
    ],
  },
  { _id: false }
);

const slaConditionsSchema = new Schema<SlaConditions>(
  {
    priority: [{ type: Number, min: 1, max: 5 }],
    ticket_types: [{ type: String }],
  },
  { _id: false }
);

const slaConfigSchema = new Schema<SlaConfigDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    conditions: { type: slaConditionsSchema, required: true },
    response_time_minutes: { type: Number, required: true, min: 1 },
    resolution_time_minutes: { type: Number, required: true, min: 1 },
    business_hours: businessHoursSchema,
    enabled: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'sla_configs',
  }
);

slaConfigSchema.index({ tenant_id: 1 });

export const SlaConfig: Model<SlaConfigDocument> = mongoose.model<SlaConfigDocument>(
  'SlaConfig',
  slaConfigSchema
);
