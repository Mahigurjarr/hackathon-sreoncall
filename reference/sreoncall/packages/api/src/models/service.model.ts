import mongoose, { Document, Schema } from 'mongoose';

export type ServiceClassification = 'app' | 'platform' | 'infrastructure' | 'monitoring' | 'system';

export interface IService extends Document {
  tenant_id: Schema.Types.ObjectId;
  project_id: Schema.Types.ObjectId;
  name: string;
  description: string;
  type: 'web' | 'api' | 'database' | 'queue' | 'cache' | 'worker' | 'storage' | 'other';
  classification: ServiceClassification;
  auto_discovered: boolean;
  source_asset_id: Schema.Types.ObjectId | null;
  current_status: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance' | 'unknown';
  // null = never explicitly set by a human or the cascade engine (e.g. a
  // freshly-created/discovered service) — eligible for cascading, unlike
  // 'manual' which means a human deliberately set this status. 'alert' means
  // an alert rule set this status directly — a trust boundary exactly like
  // 'manual': the cascade engine can propagate past it but must never
  // silently overwrite or auto-clear it, since only the alert resolving
  // should move a service off 'alert'.
  status_source: 'manual' | 'cascaded' | 'alert' | null;
  status_updated_at: Date | null;
  escalation_policy_id: Schema.Types.ObjectId | null;
  oncall_schedule_id: Schema.Types.ObjectId | null;
  owner_id: Schema.Types.ObjectId | null;
  enabled: boolean;
  tags: string[];
  // Alternate names this service is also known by — populated when discovery
  // matches a newly-found name to this service via normalized (generic-suffix-
  // stripped) comparison rather than an exact match, e.g. 'checkout-svc'
  // gaining the alias 'checkout' once traces reference it by that name.
  aliases: string[];
  notes: string | null;
  cloud_metadata: {
    provider: string | null;
    resource_type: string | null;
    cloud_id: string | null;
    region: string | null;
    cluster: string | null;
    namespace: string | null;
  } | null;
  deleted_at: Date | null;
  created_by: Schema.Types.ObjectId;
  created_at: Date;
  updated_at: Date;
}

const S = new Schema<IService>(
  {
    tenant_id: { type: Schema.Types.ObjectId, required: true, index: true },
    project_id: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    type: {
      type: String,
      enum: ['web', 'api', 'database', 'queue', 'cache', 'worker', 'storage', 'other'],
      default: 'web',
    },
    classification: {
      type: String,
      enum: ['app', 'platform', 'infrastructure', 'monitoring', 'system'],
      default: 'app',
    },
    auto_discovered:  { type: Boolean, default: false },
    source_asset_id:  { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    current_status: {
      type: String,
      enum: ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance', 'unknown'],
      default: 'unknown',
    },
    status_source: { type: String, enum: ['manual', 'cascaded', 'alert'], default: null },
    status_updated_at: { type: Date, default: null },
    escalation_policy_id: { type: Schema.Types.ObjectId, ref: 'EscalationPolicy', default: null },
    oncall_schedule_id: { type: Schema.Types.ObjectId, ref: 'OnCallSchedule', default: null },
    owner_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    enabled: { type: Boolean, default: true },
    tags: [String],
    aliases: { type: [String], default: [] },
    notes: { type: String, default: null },
    cloud_metadata: {
      type: {
        provider:      { type: String, default: null },
        resource_type: { type: String, default: null },
        cloud_id:      { type: String, default: null },
        region:        { type: String, default: null },
        cluster:       { type: String, default: null },
        namespace:     { type: String, default: null },
      },
      default: null,
    },
    deleted_at: { type: Date, default: null },
    created_by: Schema.Types.ObjectId,
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

S.index({ tenant_id: 1, name: 1 });
S.index({ tenant_id: 1, aliases: 1 });
S.index({ tenant_id: 1, project_id: 1 });
S.index({ tenant_id: 1, classification: 1 });

export const Service = mongoose.model<IService>('Service', S);
