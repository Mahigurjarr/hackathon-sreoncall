import { logger } from '../utils/logger';
import { discoverAWSReal } from './aws-discovery.service';
import { discoverScalewayReal } from './scaleway-discovery.service';
import { discoverDigitalOceanReal } from './digitalocean-discovery.service';
import { discoverHerokuReal } from './heroku-discovery.service';
import { discoverSupabaseReal } from './supabase-discovery.service';
import { discoverVercelReal } from './vercel-discovery.service';
import { discoverGCPReal } from './gcp-discovery.service';
import { discoverAzureReal } from './azure-discovery.service';

export interface DiscoveredService {
  service_type: string;
  display_name: string;
  count: number;
  details: string;
  recommended: boolean;
  high_cardinality: boolean;
}

export interface DiscoveredAsset {
  name: string;
  provider: 'aws' | 'gcp' | 'azure' | 'scaleway' | 'digitalocean' | 'heroku' | 'supabase' | 'vercel' | 'self_managed';
  category: 'compute' | 'kubernetes' | 'container' | 'serverless' | 'database' | 'networking' | 'queue' | 'cache' | 'storage' | 'app_platform';
  resource_type: string;
  region: string;
  cloud_id: string;
  cloud_account_id: string;
  metadata: Record<string, unknown>;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  status_reason: string | null;
  // K8s hierarchy
  parent_cloud_id: string | null;
  k8s_namespace: string | null;
  k8s_kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Job' | 'CronJob' | null;
  k8s_replicas_desired: number | null;
  k8s_replicas_ready: number | null;
  k8s_pod_issues: string[];
  // Aggregation
  is_aggregate: boolean;
  aggregate_count: number | null;
}

export interface CloudDiscoveryResult {
  provider: string;
  services: DiscoveredService[];
  assets: DiscoveredAsset[];
  recommended_alerts: string[];
  recommended_dashboards: string[];
}

// For now, return realistic static data based on provider type.
// In production, this would use AWS SDK, GCP client, Azure SDK.
export async function discoverCloudServices(
  provider: 'aws' | 'gcp' | 'azure' | 'scaleway' | 'digitalocean' | 'heroku' | 'supabase' | 'vercel',
  credentials: Record<string, string>,
): Promise<CloudDiscoveryResult> {
  // Log the discovery attempt (don't log credentials)
  logger.info('Cloud discovery started', { provider });

  // Use real SDK discovery when credentials are provided, fall back to mock
  switch (provider) {
    case 'aws': {
      if (!credentials.access_key_id || !credentials.secret_access_key) {
        throw new Error('AWS access_key_id and secret_access_key are required');
      }
      // Real SDK call — propagate any error so the validate-credentials
      // endpoint can reject invalid credentials with HTTP 401.
      return await discoverAWSReal(credentials);
    }
    case 'scaleway': {
      if (credentials.secret_key) {
        try {
          return await discoverScalewayReal(credentials);
        } catch (err: any) {
          logger.warn('Real Scaleway discovery failed', { error: err.message });
          throw err;
        }
      }
      throw new Error('Scaleway secret_key is required');
    }
    case 'digitalocean': {
      if (credentials.api_token) {
        try {
          return await discoverDigitalOceanReal(credentials);
        } catch (err: any) {
          logger.warn('DigitalOcean discovery failed', { error: err.message });
          throw err;
        }
      }
      throw new Error('DigitalOcean api_token is required');
    }
    case 'heroku': {
      if (credentials.api_key) {
        try {
          return await discoverHerokuReal(credentials);
        } catch (err: any) {
          logger.warn('Heroku discovery failed', { error: err.message });
          throw err;
        }
      }
      throw new Error('Heroku api_key is required');
    }
    case 'supabase': {
      if (credentials.access_token) return await discoverSupabaseReal(credentials);
      throw new Error('Supabase access_token is required');
    }
    case 'vercel': {
      if (credentials.api_token) return await discoverVercelReal(credentials);
      throw new Error('Vercel api_token is required');
    }
    case 'gcp': {
      const hasJson = !!(credentials.service_account_key || credentials.service_account_json);
      const hasTriple = !!(credentials.project_id && credentials.client_email && credentials.private_key);
      if (!hasJson && !hasTriple) {
        throw new Error('GCP credentials required: provide service_account_json (JSON key) or project_id + client_email + private_key.');
      }
      return await discoverGCPReal(credentials);
    }
    case 'azure': {
      if (!credentials.tenant_id || !credentials.client_id || !credentials.client_secret || !credentials.subscription_id) {
        throw new Error('Azure credentials required: tenant_id, client_id, client_secret, and subscription_id are all required.');
      }
      return await discoverAzureReal(credentials);
    }
  }
}

function makeAsset(overrides: Partial<DiscoveredAsset> & Pick<DiscoveredAsset, 'name' | 'provider' | 'category' | 'resource_type' | 'cloud_id'>): DiscoveredAsset {
  return {
    region: '',
    cloud_account_id: '',
    metadata: {},
    status: 'healthy',
    status_reason: null,
    parent_cloud_id: null,
    k8s_namespace: null,
    k8s_kind: null,
    k8s_replicas_desired: null,
    k8s_replicas_ready: null,
    k8s_pod_issues: [],
    is_aggregate: false,
    aggregate_count: null,
    ...overrides,
  };
}

async function discoverAWS(_credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  // TODO: Replace with real AWS SDK calls (EC2, RDS, Lambda, etc.)
  const accountId = '123456789012';
  const region = 'us-east-1';

  const assets: DiscoveredAsset[] = [
    // EKS cluster
    makeAsset({
      name: 'prod-cluster', provider: 'aws', category: 'kubernetes', resource_type: 'eks',
      region, cloud_id: `arn:aws:eks:${region}:${accountId}:cluster/prod-cluster`, cloud_account_id: accountId,
      metadata: { version: '1.29', node_count: 3 }, status: 'degraded', status_reason: '1 workload failing',
    }),
    // K8s workloads under prod-cluster
    makeAsset({
      name: 'payment-svc', provider: 'aws', category: 'kubernetes', resource_type: 'eks_workload',
      region, cloud_id: `eks:prod-cluster/payments/deployment/payment-svc`, cloud_account_id: accountId,
      parent_cloud_id: `arn:aws:eks:${region}:${accountId}:cluster/prod-cluster`,
      k8s_namespace: 'payments', k8s_kind: 'Deployment', k8s_replicas_desired: 3, k8s_replicas_ready: 3,
      metadata: { image: 'payment-svc:v2.4.1' },
    }),
    makeAsset({
      name: 'payment-worker', provider: 'aws', category: 'kubernetes', resource_type: 'eks_workload',
      region, cloud_id: `eks:prod-cluster/payments/deployment/payment-worker`, cloud_account_id: accountId,
      parent_cloud_id: `arn:aws:eks:${region}:${accountId}:cluster/prod-cluster`,
      k8s_namespace: 'payments', k8s_kind: 'Deployment', k8s_replicas_desired: 2, k8s_replicas_ready: 1,
      metadata: { image: 'payment-worker:v2.4.1' }, status: 'unhealthy', status_reason: '1 pod CrashLoopBackOff',
      k8s_pod_issues: ['1 CrashLoopBackOff'],
    }),
    makeAsset({
      name: 'payment-gateway', provider: 'aws', category: 'kubernetes', resource_type: 'eks_workload',
      region, cloud_id: `eks:prod-cluster/payments/deployment/payment-gateway`, cloud_account_id: accountId,
      parent_cloud_id: `arn:aws:eks:${region}:${accountId}:cluster/prod-cluster`,
      k8s_namespace: 'payments', k8s_kind: 'Deployment', k8s_replicas_desired: 2, k8s_replicas_ready: 2,
      metadata: { image: 'payment-gw:v1.8.0' },
    }),
    makeAsset({
      name: 'redis', provider: 'aws', category: 'kubernetes', resource_type: 'eks_workload',
      region, cloud_id: `eks:prod-cluster/payments/statefulset/redis`, cloud_account_id: accountId,
      parent_cloud_id: `arn:aws:eks:${region}:${accountId}:cluster/prod-cluster`,
      k8s_namespace: 'payments', k8s_kind: 'StatefulSet', k8s_replicas_desired: 1, k8s_replicas_ready: 1,
      metadata: { image: 'redis:7.2' },
    }),
    makeAsset({
      name: 'user-api', provider: 'aws', category: 'kubernetes', resource_type: 'eks_workload',
      region, cloud_id: `eks:prod-cluster/platform/deployment/user-api`, cloud_account_id: accountId,
      parent_cloud_id: `arn:aws:eks:${region}:${accountId}:cluster/prod-cluster`,
      k8s_namespace: 'platform', k8s_kind: 'Deployment', k8s_replicas_desired: 3, k8s_replicas_ready: 3,
      metadata: { image: 'user-api:v3.1.0' },
    }),
    makeAsset({
      name: 'notification-worker', provider: 'aws', category: 'kubernetes', resource_type: 'eks_workload',
      region, cloud_id: `eks:prod-cluster/platform/deployment/notification-worker`, cloud_account_id: accountId,
      parent_cloud_id: `arn:aws:eks:${region}:${accountId}:cluster/prod-cluster`,
      k8s_namespace: 'platform', k8s_kind: 'Deployment', k8s_replicas_desired: 2, k8s_replicas_ready: 2,
      metadata: { image: 'notification-worker:v1.5.2' },
    }),
    // EC2 instances
    makeAsset({
      name: 'web-server-01', provider: 'aws', category: 'compute', resource_type: 'ec2',
      region, cloud_id: `i-0abc123def01`, cloud_account_id: accountId,
      metadata: { instance_type: 't3.large', az: 'us-east-1a' },
    }),
    makeAsset({
      name: 'web-server-02', provider: 'aws', category: 'compute', resource_type: 'ec2',
      region, cloud_id: `i-0abc123def02`, cloud_account_id: accountId,
      metadata: { instance_type: 't3.large', az: 'us-east-1b' },
    }),
    makeAsset({
      name: 'api-server-01', provider: 'aws', category: 'compute', resource_type: 'ec2',
      region, cloud_id: `i-0abc123def03`, cloud_account_id: accountId,
      metadata: { instance_type: 'c6g.xlarge', az: 'us-east-1a' },
    }),
    makeAsset({
      name: 'batch-processor', provider: 'aws', category: 'compute', resource_type: 'ec2',
      region, cloud_id: `i-0abc123def04`, cloud_account_id: accountId,
      metadata: { instance_type: 'm6g.2xlarge', az: 'us-east-1c' },
      status: 'degraded', status_reason: 'High CPU',
    }),
    // RDS
    makeAsset({
      name: 'main-postgres', provider: 'aws', category: 'database', resource_type: 'rds',
      region, cloud_id: `arn:aws:rds:${region}:${accountId}:db:main-postgres`, cloud_account_id: accountId,
      metadata: { engine: 'PostgreSQL 16', instance_class: 'db.r6g.xlarge', multi_az: true },
    }),
    makeAsset({
      name: 'analytics-db', provider: 'aws', category: 'database', resource_type: 'rds',
      region, cloud_id: `arn:aws:rds:${region}:${accountId}:db:analytics-db`, cloud_account_id: accountId,
      metadata: { engine: 'PostgreSQL 15', instance_class: 'db.m6g.large', multi_az: false },
    }),
    // ALBs
    makeAsset({
      name: 'prod-alb', provider: 'aws', category: 'networking', resource_type: 'alb',
      region, cloud_id: `arn:aws:elasticloadbalancing:${region}:${accountId}:loadbalancer/app/prod-alb/abc`, cloud_account_id: accountId,
      metadata: { target_groups: 3 },
    }),
    makeAsset({
      name: 'api-alb', provider: 'aws', category: 'networking', resource_type: 'alb',
      region, cloud_id: `arn:aws:elasticloadbalancing:${region}:${accountId}:loadbalancer/app/api-alb/def`, cloud_account_id: accountId,
      metadata: { target_groups: 2 },
    }),
    makeAsset({
      name: 'cdn-distribution', provider: 'aws', category: 'networking', resource_type: 'cloudfront',
      region: 'global', cloud_id: `arn:aws:cloudfront::${accountId}:distribution/E12345`, cloud_account_id: accountId,
      metadata: { origins: 4 },
    }),
    // ElastiCache
    makeAsset({
      name: 'prod-redis', provider: 'aws', category: 'cache', resource_type: 'elasticache',
      region, cloud_id: `arn:aws:elasticache:${region}:${accountId}:cluster:prod-redis`, cloud_account_id: accountId,
      metadata: { engine: 'redis', node_type: 'cache.r6g.large', num_nodes: 1 },
    }),
    // SQS
    makeAsset({
      name: 'order-queue', provider: 'aws', category: 'queue', resource_type: 'sqs',
      region, cloud_id: `arn:aws:sqs:${region}:${accountId}:order-queue`, cloud_account_id: accountId,
      metadata: { approximate_messages: 12 },
    }),
    // Lambda (aggregated)
    makeAsset({
      name: '15 Lambda functions', provider: 'aws', category: 'serverless', resource_type: 'lambda',
      region, cloud_id: `aggregate:lambda:${accountId}:${region}`, cloud_account_id: accountId,
      is_aggregate: true, aggregate_count: 15,
      status: 'degraded', status_reason: '1 high error rate',
    }),
    // S3 (aggregated)
    makeAsset({
      name: '24 S3 buckets', provider: 'aws', category: 'storage', resource_type: 's3',
      region, cloud_id: `aggregate:s3:${accountId}`, cloud_account_id: accountId,
      is_aggregate: true, aggregate_count: 24,
    }),
  ];

  return {
    provider: 'aws',
    services: [
      { service_type: 'ec2', display_name: 'EC2 Instances', count: 8, details: '8 instances (3 regions)', recommended: true, high_cardinality: false },
      { service_type: 'rds', display_name: 'RDS Databases', count: 2, details: '2 databases (us-east-1)', recommended: true, high_cardinality: false },
      { service_type: 'lambda', display_name: 'Lambda Functions', count: 15, details: '15 functions (2 regions)', recommended: true, high_cardinality: false },
      { service_type: 'alb', display_name: 'Application Load Balancers', count: 3, details: '3 load balancers', recommended: true, high_cardinality: false },
      { service_type: 'ecs', display_name: 'ECS Clusters', count: 2, details: '2 clusters (12 services)', recommended: true, high_cardinality: false },
      { service_type: 's3', display_name: 'S3 Buckets', count: 24, details: '24 buckets', recommended: false, high_cardinality: true },
      { service_type: 'sqs', display_name: 'SQS Queues', count: 5, details: '5 queues', recommended: true, high_cardinality: false },
      { service_type: 'elasticache', display_name: 'ElastiCache Clusters', count: 1, details: '1 Redis cluster', recommended: true, high_cardinality: false },
      { service_type: 'dynamodb', display_name: 'DynamoDB Tables', count: 3, details: '3 tables', recommended: false, high_cardinality: true },
      { service_type: 'cloudfront', display_name: 'CloudFront Distributions', count: 2, details: '2 distributions', recommended: true, high_cardinality: false },
      { service_type: 'eks', display_name: 'EKS Clusters', count: 1, details: '1 cluster (us-east-1)', recommended: true, high_cardinality: false },
    ],
    assets,
    recommended_alerts: [
      'EC2 CPU utilization > 80%',
      'RDS connection count > 90% of max',
      'Lambda error rate > 5%',
      'ALB 5xx error rate > 1%',
      'ECS service unhealthy task count > 0',
      'SQS queue depth > 1000 messages',
      'ElastiCache memory utilization > 85%',
      'EKS pod restart count > 5 in 10m',
    ],
    recommended_dashboards: [
      'AWS Infrastructure Overview',
      'EC2 Fleet Health',
      'RDS Performance',
      'Lambda Invocations & Errors',
      'ECS/EKS Container Health',
      'ALB Traffic & Latency',
    ],
  };
}

async function discoverGCP(_credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  // TODO: Replace with real GCP client library calls
  const projectId = 'my-gcp-project';
  const region = 'us-central1';

  const assets: DiscoveredAsset[] = [
    makeAsset({
      name: 'gke-prod', provider: 'gcp', category: 'kubernetes', resource_type: 'gke',
      region, cloud_id: `projects/${projectId}/locations/${region}/clusters/gke-prod`, cloud_account_id: projectId,
      metadata: { version: '1.28', node_count: 2 },
    }),
    makeAsset({
      name: 'web-vm-01', provider: 'gcp', category: 'compute', resource_type: 'compute_engine',
      region, cloud_id: `projects/${projectId}/zones/${region}-a/instances/web-vm-01`, cloud_account_id: projectId,
      metadata: { machine_type: 'e2-standard-4' },
    }),
    makeAsset({
      name: 'app-db', provider: 'gcp', category: 'database', resource_type: 'cloud_sql',
      region, cloud_id: `projects/${projectId}/instances/app-db`, cloud_account_id: projectId,
      metadata: { engine: 'PostgreSQL 15', tier: 'db-custom-4-16384' },
    }),
    makeAsset({
      name: '8 Cloud Functions', provider: 'gcp', category: 'serverless', resource_type: 'cloud_functions',
      region, cloud_id: `aggregate:cloud_functions:${projectId}`, cloud_account_id: projectId,
      is_aggregate: true, aggregate_count: 8,
    }),
    makeAsset({
      name: '15 Cloud Storage buckets', provider: 'gcp', category: 'storage', resource_type: 'cloud_storage',
      region, cloud_id: `aggregate:cloud_storage:${projectId}`, cloud_account_id: projectId,
      is_aggregate: true, aggregate_count: 15,
    }),
    makeAsset({
      name: 'events-topic', provider: 'gcp', category: 'queue', resource_type: 'pubsub',
      region, cloud_id: `projects/${projectId}/topics/events-topic`, cloud_account_id: projectId,
    }),
  ];

  return {
    provider: 'gcp',
    services: [
      { service_type: 'compute_engine', display_name: 'Compute Engine Instances', count: 6, details: '6 instances (2 zones)', recommended: true, high_cardinality: false },
      { service_type: 'cloud_sql', display_name: 'Cloud SQL Databases', count: 2, details: '2 databases (us-central1)', recommended: true, high_cardinality: false },
      { service_type: 'gke', display_name: 'GKE Clusters', count: 1, details: '1 cluster (us-central1)', recommended: true, high_cardinality: false },
      { service_type: 'cloud_run', display_name: 'Cloud Run Services', count: 4, details: '4 services', recommended: true, high_cardinality: false },
      { service_type: 'cloud_functions', display_name: 'Cloud Functions', count: 8, details: '8 functions (2 regions)', recommended: true, high_cardinality: false },
      { service_type: 'pubsub', display_name: 'Pub/Sub Topics', count: 3, details: '3 topics', recommended: true, high_cardinality: false },
      { service_type: 'cloud_storage', display_name: 'Cloud Storage Buckets', count: 15, details: '15 buckets', recommended: false, high_cardinality: true },
    ],
    assets,
    recommended_alerts: [
      'Compute Engine CPU utilization > 80%',
      'Cloud SQL connection count > 90% of max',
      'GKE pod restart count > 5 in 10m',
      'Cloud Run request latency p99 > 2s',
      'Cloud Functions error rate > 5%',
      'Pub/Sub unacked message count > 500',
    ],
    recommended_dashboards: [
      'GCP Infrastructure Overview',
      'Compute Engine Fleet Health',
      'Cloud SQL Performance',
      'GKE Cluster Health',
      'Cloud Run & Functions',
    ],
  };
}

async function discoverAzure(_credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  // TODO: Replace with real Azure SDK calls
  const subscriptionId = 'sub-12345';
  const region = 'eastus';

  const assets: DiscoveredAsset[] = [
    makeAsset({
      name: 'aks-prod', provider: 'azure', category: 'kubernetes', resource_type: 'aks',
      region, cloud_id: `/subscriptions/${subscriptionId}/resourceGroups/rg-prod/providers/Microsoft.ContainerService/managedClusters/aks-prod`,
      cloud_account_id: subscriptionId, metadata: { version: '1.28', node_count: 3 },
    }),
    makeAsset({
      name: 'app-vm-01', provider: 'azure', category: 'compute', resource_type: 'virtual_machines',
      region, cloud_id: `/subscriptions/${subscriptionId}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/app-vm-01`,
      cloud_account_id: subscriptionId, metadata: { vm_size: 'Standard_D4s_v3' },
    }),
    makeAsset({
      name: 'prod-sql', provider: 'azure', category: 'database', resource_type: 'sql_database',
      region, cloud_id: `/subscriptions/${subscriptionId}/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/prod-sql`,
      cloud_account_id: subscriptionId, metadata: { tier: 'GeneralPurpose' },
    }),
    makeAsset({
      name: '6 Azure Functions', provider: 'azure', category: 'serverless', resource_type: 'functions',
      region, cloud_id: `aggregate:functions:${subscriptionId}`, cloud_account_id: subscriptionId,
      is_aggregate: true, aggregate_count: 6,
    }),
    makeAsset({
      name: '8 Storage Accounts', provider: 'azure', category: 'storage', resource_type: 'storage_accounts',
      region, cloud_id: `aggregate:storage_accounts:${subscriptionId}`, cloud_account_id: subscriptionId,
      is_aggregate: true, aggregate_count: 8,
    }),
  ];

  return {
    provider: 'azure',
    services: [
      { service_type: 'virtual_machines', display_name: 'Virtual Machines', count: 5, details: '5 VMs (2 regions)', recommended: true, high_cardinality: false },
      { service_type: 'sql_database', display_name: 'SQL Databases', count: 2, details: '2 databases (East US)', recommended: true, high_cardinality: false },
      { service_type: 'aks', display_name: 'AKS Clusters', count: 1, details: '1 cluster (East US)', recommended: true, high_cardinality: false },
      { service_type: 'functions', display_name: 'Azure Functions', count: 6, details: '6 functions', recommended: true, high_cardinality: false },
      { service_type: 'app_service', display_name: 'App Service Plans', count: 3, details: '3 app services', recommended: true, high_cardinality: false },
      { service_type: 'storage_accounts', display_name: 'Storage Accounts', count: 8, details: '8 storage accounts', recommended: false, high_cardinality: true },
      { service_type: 'cosmos_db', display_name: 'Cosmos DB Accounts', count: 1, details: '1 account (multi-region)', recommended: true, high_cardinality: false },
    ],
    assets,
    recommended_alerts: [
      'VM CPU utilization > 80%',
      'SQL Database DTU consumption > 90%',
      'AKS pod restart count > 5 in 10m',
      'Functions error rate > 5%',
      'App Service HTTP 5xx rate > 1%',
      'Cosmos DB request unit consumption > 85%',
    ],
    recommended_dashboards: [
      'Azure Infrastructure Overview',
      'Virtual Machine Fleet Health',
      'SQL Database Performance',
      'AKS Cluster Health',
      'App Service & Functions',
    ],
  };
}
