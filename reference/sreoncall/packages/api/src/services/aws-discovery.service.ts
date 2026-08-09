import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { EKSClient, ListClustersCommand, DescribeClusterCommand } from '@aws-sdk/client-eks';
import { ElastiCacheClient, DescribeCacheClustersCommand } from '@aws-sdk/client-elasticache';
import { SQSClient, ListQueuesCommand } from '@aws-sdk/client-sqs';
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { logger } from '../utils/logger';
import type { DiscoveredAsset, DiscoveredService, CloudDiscoveryResult } from './cloud-discovery.service';

function makeAsset(
  overrides: Partial<DiscoveredAsset> &
    Pick<DiscoveredAsset, 'name' | 'provider' | 'category' | 'resource_type' | 'cloud_id'>,
): DiscoveredAsset {
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

interface AWSCreds {
  access_key_id?: string;
  secret_access_key?: string;
  region?: string;
}

function getClientConfig(creds: AWSCreds) {
  const region = creds.region || process.env.AWS_REGION || 'us-east-1';
  const config: any = { region };
  if (creds.access_key_id && creds.secret_access_key) {
    config.credentials = {
      accessKeyId: creds.access_key_id,
      secretAccessKey: creds.secret_access_key,
    };
  }
  return config;
}

export async function discoverAWSReal(credentials: Record<string, string>): Promise<CloudDiscoveryResult> {
  const creds = credentials as AWSCreds;
  const config = getClientConfig(creds);
  const region = config.region;

  // Get account ID
  let accountId = '';
  try {
    const sts = new STSClient(config);
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    accountId = identity.Account || '';
  } catch (err: any) {
    logger.warn('Failed to get AWS account ID', { error: err.message });
  }

  const assets: DiscoveredAsset[] = [];
  const services: DiscoveredService[] = [];

  // Discover in parallel with error tolerance
  const results = await Promise.allSettled([
    discoverEC2(config, region, accountId, assets, services),
    discoverRDS(config, region, accountId, assets, services),
    discoverEKS(config, region, accountId, assets, services),
    discoverLambda(config, region, accountId, assets, services),
    discoverElastiCache(config, region, accountId, assets, services),
    discoverSQS(config, region, accountId, assets, services),
    discoverALB(config, region, accountId, assets, services),
    discoverS3(config, accountId, assets, services),
  ]);

  for (const r of results) {
    if (r.status === 'rejected') {
      logger.warn('AWS discovery sub-task failed', { error: r.reason?.message });
    }
  }

  return {
    provider: 'aws',
    services,
    assets,
    recommended_alerts: [
      'EC2 CPU utilization > 80%',
      'RDS connection count > 90% of max',
      'Lambda error rate > 5%',
      'ALB 5xx error rate > 1%',
      'EKS pod restart count > 5 in 10m',
      'SQS queue depth > 1000 messages',
      'ElastiCache memory utilization > 85%',
    ],
    recommended_dashboards: [
      'AWS Infrastructure Overview',
      'EC2 Fleet Health',
      'RDS Performance',
      'Lambda Invocations & Errors',
      'EKS Container Health',
      'ALB Traffic & Latency',
    ],
  };
}

async function discoverEC2(
  config: any, region: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const ec2 = new EC2Client(config);
  const resp = await ec2.send(new DescribeInstancesCommand({ MaxResults: 100 }));
  const instances = (resp.Reservations || []).flatMap((r) => r.Instances || []);
  const running = instances.filter((i) => i.State?.Name === 'running');

  services.push({
    service_type: 'ec2',
    display_name: 'EC2 Instances',
    count: running.length,
    details: `${running.length} running instances (${region})`,
    recommended: true,
    high_cardinality: running.length > 20,
  });

  if (running.length > 10) {
    assets.push(makeAsset({
      name: `${running.length} EC2 instances`,
      provider: 'aws', category: 'compute', resource_type: 'ec2',
      region, cloud_id: `aggregate:ec2:${accountId}:${region}`, cloud_account_id: accountId,
      is_aggregate: true, aggregate_count: running.length,
    }));
  } else {
    for (const inst of running) {
      const nameTag = inst.Tags?.find((t) => t.Key === 'Name')?.Value || inst.InstanceId || 'unnamed';
      assets.push(makeAsset({
        name: nameTag,
        provider: 'aws', category: 'compute', resource_type: 'ec2',
        region, cloud_id: inst.InstanceId || '', cloud_account_id: accountId,
        metadata: {
          instance_type: inst.InstanceType,
          az: inst.Placement?.AvailabilityZone,
          private_ip: inst.PrivateIpAddress,
          launch_time: inst.LaunchTime?.toISOString(),
        },
      }));
    }
  }
}

async function discoverRDS(
  config: any, region: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const rds = new RDSClient(config);
  const resp = await rds.send(new DescribeDBInstancesCommand({ MaxRecords: 100 }));
  const dbs = resp.DBInstances || [];

  services.push({
    service_type: 'rds',
    display_name: 'RDS Databases',
    count: dbs.length,
    details: `${dbs.length} databases (${region})`,
    recommended: true,
    high_cardinality: false,
  });

  for (const db of dbs) {
    const status = db.DBInstanceStatus === 'available' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: db.DBInstanceIdentifier || 'unnamed',
      provider: 'aws', category: 'database', resource_type: 'rds',
      region, cloud_id: db.DBInstanceArn || '', cloud_account_id: accountId,
      metadata: {
        engine: `${db.Engine} ${db.EngineVersion}`,
        instance_class: db.DBInstanceClass,
        multi_az: db.MultiAZ,
        storage_gb: db.AllocatedStorage,
      },
      status,
      status_reason: status !== 'healthy' ? db.DBInstanceStatus : null,
    }));
  }
}

async function discoverEKS(
  config: any, region: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const eks = new EKSClient(config);
  const listResp = await eks.send(new ListClustersCommand({}));
  const clusterNames = listResp.clusters || [];

  services.push({
    service_type: 'eks',
    display_name: 'EKS Clusters',
    count: clusterNames.length,
    details: `${clusterNames.length} cluster${clusterNames.length !== 1 ? 's' : ''} (${region})`,
    recommended: true,
    high_cardinality: false,
  });

  for (const name of clusterNames) {
    try {
      const descResp = await eks.send(new DescribeClusterCommand({ name }));
      const cluster = descResp.cluster;
      if (!cluster) continue;
      const status = cluster.status === 'ACTIVE' ? 'healthy' : 'degraded';
      assets.push(makeAsset({
        name: cluster.name || name,
        provider: 'aws', category: 'kubernetes', resource_type: 'eks',
        region, cloud_id: cluster.arn || '', cloud_account_id: accountId,
        metadata: {
          version: cluster.version,
          platform_version: cluster.platformVersion,
          endpoint: cluster.endpoint,
        },
        status,
        status_reason: status !== 'healthy' ? `Status: ${cluster.status}` : null,
      }));
    } catch (err: any) {
      logger.warn(`Failed to describe EKS cluster ${name}`, { error: err.message });
    }
  }
}

async function discoverLambda(
  config: any, region: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const lambda = new LambdaClient(config);
  const resp = await lambda.send(new ListFunctionsCommand({ MaxItems: 100 }));
  const functions = resp.Functions || [];

  services.push({
    service_type: 'lambda',
    display_name: 'Lambda Functions',
    count: functions.length,
    details: `${functions.length} functions (${region})`,
    recommended: true,
    high_cardinality: functions.length > 10,
  });

  // Always aggregate Lambda (typically high cardinality)
  if (functions.length > 0) {
    assets.push(makeAsset({
      name: `${functions.length} Lambda functions`,
      provider: 'aws', category: 'serverless', resource_type: 'lambda',
      region, cloud_id: `aggregate:lambda:${accountId}:${region}`, cloud_account_id: accountId,
      is_aggregate: true, aggregate_count: functions.length,
    }));
  }
}

async function discoverElastiCache(
  config: any, region: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const client = new ElastiCacheClient(config);
  const resp = await client.send(new DescribeCacheClustersCommand({ MaxRecords: 100 }));
  const clusters = resp.CacheClusters || [];

  if (clusters.length === 0) return;

  services.push({
    service_type: 'elasticache',
    display_name: 'ElastiCache Clusters',
    count: clusters.length,
    details: `${clusters.length} cluster${clusters.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  for (const c of clusters) {
    const status = c.CacheClusterStatus === 'available' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: c.CacheClusterId || 'unnamed',
      provider: 'aws', category: 'cache', resource_type: 'elasticache',
      region, cloud_id: c.ARN || '', cloud_account_id: accountId,
      metadata: {
        engine: c.Engine,
        node_type: c.CacheNodeType,
        num_nodes: c.NumCacheNodes,
      },
      status,
    }));
  }
}

async function discoverSQS(
  config: any, region: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const sqs = new SQSClient(config);
  const resp = await sqs.send(new ListQueuesCommand({ MaxResults: 100 }));
  const queueUrls = resp.QueueUrls || [];

  if (queueUrls.length === 0) return;

  services.push({
    service_type: 'sqs',
    display_name: 'SQS Queues',
    count: queueUrls.length,
    details: `${queueUrls.length} queues`,
    recommended: true,
    high_cardinality: queueUrls.length > 10,
  });

  if (queueUrls.length > 10) {
    assets.push(makeAsset({
      name: `${queueUrls.length} SQS queues`,
      provider: 'aws', category: 'queue', resource_type: 'sqs',
      region, cloud_id: `aggregate:sqs:${accountId}:${region}`, cloud_account_id: accountId,
      is_aggregate: true, aggregate_count: queueUrls.length,
    }));
  } else {
    for (const url of queueUrls) {
      const name = url.split('/').pop() || 'unnamed';
      assets.push(makeAsset({
        name,
        provider: 'aws', category: 'queue', resource_type: 'sqs',
        region, cloud_id: url, cloud_account_id: accountId,
      }));
    }
  }
}

async function discoverALB(
  config: any, region: string, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const elbv2 = new ElasticLoadBalancingV2Client(config);
  const resp = await elbv2.send(new DescribeLoadBalancersCommand({}));
  const lbs = resp.LoadBalancers || [];

  if (lbs.length === 0) return;

  services.push({
    service_type: 'alb',
    display_name: 'Load Balancers',
    count: lbs.length,
    details: `${lbs.length} load balancer${lbs.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  for (const lb of lbs) {
    const status = lb.State?.Code === 'active' ? 'healthy' : 'degraded';
    assets.push(makeAsset({
      name: lb.LoadBalancerName || 'unnamed',
      provider: 'aws', category: 'networking', resource_type: lb.Type === 'network' ? 'nlb' : 'alb',
      region, cloud_id: lb.LoadBalancerArn || '', cloud_account_id: accountId,
      metadata: { type: lb.Type, scheme: lb.Scheme, dns: lb.DNSName },
      status,
    }));
  }
}

async function discoverS3(
  config: any, accountId: string,
  assets: DiscoveredAsset[], services: DiscoveredService[],
) {
  const s3 = new S3Client(config);
  const resp = await s3.send(new ListBucketsCommand({}));
  const buckets = resp.Buckets || [];

  if (buckets.length === 0) return;

  services.push({
    service_type: 's3',
    display_name: 'S3 Buckets',
    count: buckets.length,
    details: `${buckets.length} buckets`,
    recommended: false,
    high_cardinality: true,
  });

  // Always aggregate S3
  assets.push(makeAsset({
    name: `${buckets.length} S3 buckets`,
    provider: 'aws', category: 'storage', resource_type: 's3',
    region: 'global', cloud_id: `aggregate:s3:${accountId}`, cloud_account_id: accountId,
    is_aggregate: true, aggregate_count: buckets.length,
  }));
}
