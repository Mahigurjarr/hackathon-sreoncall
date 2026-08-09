import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IAlertQuality {
  tenant_id: Types.ObjectId;
  alert_rule_id: Types.ObjectId;
  period_start: Date;
  period_end: Date;
  total_firings: number;
  acknowledged_count: number;
  dismissed_count: number;
  incident_created_count: number;
  auto_resolved_count: number;
  avg_time_to_action_seconds: number | null;
  signal_score: number;
  noise_score: number;
  recommendation: 'keep' | 'retune_threshold' | 'increase_duration' | 'merge_with_other' | 'delete' | 'needs_review';
  recommendation_details: string | null;
  suggested_threshold: number | null;
  current_threshold: number | null;
}

export interface AlertQualityDocument extends IAlertQuality, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const alertQualitySchema = new Schema<AlertQualityDocument>(
  {
    tenant_id: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    alert_rule_id: { type: Schema.Types.ObjectId, ref: 'AlertRule', required: true },
    period_start: { type: Date, required: true },
    period_end: { type: Date, required: true },
    total_firings: { type: Number, default: 0 },
    acknowledged_count: { type: Number, default: 0 },
    dismissed_count: { type: Number, default: 0 },
    incident_created_count: { type: Number, default: 0 },
    auto_resolved_count: { type: Number, default: 0 },
    avg_time_to_action_seconds: { type: Number, default: null },
    signal_score: { type: Number, required: true, min: 0, max: 100 },
    noise_score: { type: Number, required: true, min: 0, max: 100 },
    recommendation: {
      type: String,
      enum: ['keep', 'retune_threshold', 'increase_duration', 'merge_with_other', 'delete', 'needs_review'],
      required: true,
    },
    recommendation_details: { type: String, default: null },
    suggested_threshold: { type: Number, default: null },
    current_threshold: { type: Number, default: null },
  },
  {
    timestamps: true,
    collection: 'alert_quality_scores',
  }
);

alertQualitySchema.index(
  { tenant_id: 1, alert_rule_id: 1, period_start: 1 },
  { unique: true }
);
alertQualitySchema.index({ tenant_id: 1, signal_score: 1 });
alertQualitySchema.index({ tenant_id: 1, noise_score: -1 });

export const AlertQuality: Model<AlertQualityDocument> = mongoose.model<AlertQualityDocument>(
  'AlertQuality',
  alertQualitySchema
);
