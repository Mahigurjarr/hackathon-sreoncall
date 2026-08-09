import mongoose, { Document, Schema } from 'mongoose';

export type AssetProvider = 'aws' | 'gcp' | 'azure' | 'scaleway' | 'digitalocean' | 'heroku' | 'supabase' | 'vercel' | 'self_managed';
export type AssetCategory = 'compute' | 'kubernetes' | 'container' | 'serverless' | 'database' | 'networking' | 'queue' | 'cache' | 'storage' | 'app_platform';
export type AssetStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'terminated';
export type K8sKind = 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Job' | 'CronJob';

export interface IAsset extends Document {
  tenant_id: Schema.Types.ObjectId;

  // Identity
  name: string;
  provider: AssetProvider;
  category: AssetCategory;
  resource_type: string;
  region: string;

  // Cloud metadata
  cloud_id: string;
  cloud_account_id: string;
  metadata: Record<string, unknown>;

  // Hierarchy (for K8s)
  parent_asset_id: Schema.Types.ObjectId | null;
  k8s_namespace: string | null;
  k8s_kind: K8sKind | null;
  k8s_replicas_desired: number | null;
  k8s_replicas_ready: number | null;
  k8s_pod_issues: string[];

  // Status
  status: AssetStatus;
  status_reason: string | null;
  last_seen_at: Date;

  // Linking
  service_id: Schema.Types.ObjectId | null;
  connection_id: Schema.Types.ObjectId;

  // Aggregation
  is_aggregate: boolean;
  aggregate_count: number | null;

  created_at: Date;
  updated_at: Date;
}

const PROVIDERS = ['aws', 'gcp', 'azure', 'scaleway', 'digitalocean', 'heroku', 'supabase', 'vercel', 'self_managed'] as const;
const CATEGORIES = ['compute', 'kubernetes', 'container', 'serverless', 'database', 'networking', 'queue', 'cache', 'storage', 'app_platform'] as const;
const STATUSES = ['healthy', 'degraded', 'unhealthy', 'unknown', 'terminated'] as const;
const K8S_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'] as const;

const S = new Schema<IAsset>(
  {
    tenant_id:          { type: Schema.Types.ObjectId, required: true, index: true },

    name:               { type: String, required: true },
    provider:           { type: String, enum: PROVIDERS, required: true },
    category:           { type: String, enum: CATEGORIES, required: true },
    resource_type:      { type: String, required: true },
    region:             { type: String, default: '' },

    cloud_id:           { type: String, required: true },
    cloud_account_id:   { type: String, default: '' },
    metadata:           { type: Schema.Types.Mixed, default: {} },

    parent_asset_id:    { type: Schema.Types.ObjectId, ref: 'Asset', default: null },
    k8s_namespace:      { type: String, default: null },
    k8s_kind:           { type: String, enum: [...K8S_KINDS, null], default: null },
    k8s_replicas_desired: { type: Number, default: null },
    k8s_replicas_ready:   { type: Number, default: null },
    k8s_pod_issues:     [{ type: String }],

    status:             { type: String, enum: STATUSES, default: 'unknown' },
    status_reason:      { type: String, default: null },
    last_seen_at:       { type: Date, default: Date.now },

    service_id:         { type: Schema.Types.ObjectId, ref: 'Service', default: null },
    connection_id:      { type: Schema.Types.ObjectId, ref: 'ObservabilityConnection', required: true },

    is_aggregate:       { type: Boolean, default: false },
    aggregate_count:    { type: Number, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

S.index({ tenant_id: 1, provider: 1 });
S.index({ tenant_id: 1, category: 1 });
S.index({ tenant_id: 1, status: 1 });
S.index({ tenant_id: 1, connection_id: 1 });
S.index({ tenant_id: 1, parent_asset_id: 1 });
S.index({ tenant_id: 1, cloud_id: 1 }, { unique: true });
S.index({ tenant_id: 1, service_id: 1 });

export const Asset = mongoose.model<IAsset>('Asset', S, 'assets');
