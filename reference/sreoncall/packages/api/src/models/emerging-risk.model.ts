import mongoose, { Document, Schema } from 'mongoose';

export interface IEmergingRisk extends Document {
  tenant_id: Schema.Types.ObjectId;
  service_id: Schema.Types.ObjectId;
  risk_type: 'metric_trending' | 'slo_burn_rate' | 'error_spike' | 'resource_exhaustion' | 'dependency_degradation';
  severity: 'warning' | 'watch';
  description: string;
  current_value: string;
  projected_value: string | null;
  projected_breach_at: Date | null;
  recommendation: string | null;
  cleared_at: Date | null;
  dismissed_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const S = new Schema<IEmergingRisk>(
  {
    tenant_id:              { type: Schema.Types.ObjectId, required: true },
    service_id:             { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    risk_type:              { type: String, enum: ['metric_trending', 'slo_burn_rate', 'error_spike', 'resource_exhaustion', 'dependency_degradation'], required: true },
    severity:               { type: String, enum: ['warning', 'watch'], default: 'watch' },
    description:            { type: String, required: true },
    current_value:          { type: String, required: true },
    projected_value:        { type: String, default: null },
    projected_breach_at:    { type: Date, default: null },
    recommendation:         { type: String, default: null },
    cleared_at:             { type: Date, default: null },
    dismissed_reason:       { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, service_id: 1 });
S.index({ tenant_id: 1, risk_type: 1 });
S.index({ cleared_at: 1 }, { expireAfterSeconds: 86400 });

export const EmergingRisk = mongoose.model<IEmergingRisk>('EmergingRisk', S, 'emerging_risks');
