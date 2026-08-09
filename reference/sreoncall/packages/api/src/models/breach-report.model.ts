import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type BreachSeverity = 'low' | 'medium' | 'high' | 'critical';
export type BreachStatus = 'detected' | 'investigating' | 'contained' | 'resolved' | 'reported';

export interface IBreachReport {
  title: string;
  description: string;
  severity: BreachSeverity;
  status: BreachStatus;
  detected_at: Date;
  contained_at?: Date;
  resolved_at?: Date;
  reported_to_authority_at?: Date;
  affected_tenants: Types.ObjectId[];
  affected_user_count: number;
  data_categories_affected: string[];
  root_cause?: string;
  remediation_steps: string[];
  reported_by: Types.ObjectId;
  authority_report_deadline: Date;
  notifications_sent: boolean;
}

export interface BreachReportDocument extends IBreachReport, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const breachReportSchema = new Schema<BreachReportDocument>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      required: true,
    },
    status: {
      type: String,
      enum: ['detected', 'investigating', 'contained', 'resolved', 'reported'],
      default: 'detected',
    },
    detected_at: { type: Date, required: true, default: Date.now },
    contained_at: { type: Date },
    resolved_at: { type: Date },
    reported_to_authority_at: { type: Date },
    affected_tenants: [{ type: Schema.Types.ObjectId, ref: 'Tenant' }],
    affected_user_count: { type: Number, default: 0 },
    data_categories_affected: [{ type: String }],
    root_cause: { type: String },
    remediation_steps: [{ type: String }],
    reported_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // GDPR Art 33: 72 hours from detection
    authority_report_deadline: { type: Date, required: true },
    notifications_sent: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'breach_reports',
  }
);

breachReportSchema.index({ status: 1, detected_at: -1 });
breachReportSchema.index({ authority_report_deadline: 1 });

export const BreachReport: Model<BreachReportDocument> = mongoose.model<BreachReportDocument>(
  'BreachReport',
  breachReportSchema
);
