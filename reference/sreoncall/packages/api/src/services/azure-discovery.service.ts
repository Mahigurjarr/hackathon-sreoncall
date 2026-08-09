import { ClientSecretCredential } from '@azure/identity';
import { ComputeManagementClient } from '@azure/arm-compute';
import { ContainerServiceClient } from '@azure/arm-containerservice';
import { SqlManagementClient } from '@azure/arm-sql';
import { StorageManagementClient } from '@azure/arm-storage';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { logger } from '../utils/logger';
import type {
  DiscoveredAsset,
  DiscoveredService,
  CloudDiscoveryResult,
} from './cloud-discovery.service';

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

interface AzureCreds {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  subscription_id: string;
}

export function parseAzureCredentials(
  credentials: Record<string, string>,
): AzureCreds {
  const missing: string[] = [];
  if (!credentials.tenant_id) missing.push('tenant_id');
  if (!credentials.client_id) missing.push('client_id');
  if (!credentials.client_secret) missing.push('client_secret');
  if (!credentials.subscription_id) missing.push('subscription_id');
  if (missing.length > 0) {
    throw new Error(
      `Azure credentials required: missing ${missing.join(', ')}. All four of tenant_id, client_id, client_secret, subscription_id must be provided.`,
    );
  }
  return {
    tenant_id: credentials.tenant_id,
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    subscription_id: credentials.subscription_id,
  };
}

function wrapAzureError(operation: string, err: any): Error {
  const msg = err?.message || String(err);
  const code = err?.code || err?.statusCode;
  if (code === 401 || /AADSTS|invalid_client|unauthorized|AuthenticationFailed/i.test(msg)) {
    return new Error(
      `Azure authentication failed during ${operation}: ${msg}. Check tenant_id, client_id, and client_secret.`,
    );
  }
  if (code === 403 || /AuthorizationFailed|forbidden/i.test(msg)) {
    return new Error(
      `Azure permission denied during ${operation}: ${msg}. Ensure the app registration has Reader role on the subscription.`,
    );
  }
  if (code === 404 || /SubscriptionNotFound/i.test(msg)) {
    return new Error(
      `Azure subscription not found during ${operation}: ${msg}. Check subscription_id.`,
    );
  }
  return new Error(`Azure ${operation} failed: ${msg}`);
}

export async function discoverAzureReal(
  credentials: Record<string, string>,
): Promise<CloudDiscoveryResult> {
  const creds = parseAzureCredentials(credentials);

  const credential = new ClientSecretCredential(
    creds.tenant_id,
    creds.client_id,
    creds.client_secret,
  );

  // Force credential validation up-front — throws on bad creds.
  try {
    await credential.getToken('https://management.azure.com/.default');
  } catch (err: any) {
    throw wrapAzureError('authentication', err);
  }

  const subId = creds.subscription_id;
  const assets: DiscoveredAsset[] = [];
  const services: DiscoveredService[] = [];

  const results = await Promise.allSettled([
    discoverVMs(credential, subId, assets, services),
    discoverAKS(credential, subId, assets, services),
    discoverSQL(credential, subId, assets, services),
    discoverStorage(credential, subId, assets, services),
    discoverAppServices(credential, subId, assets, services),
  ]);

  let anySucceeded = false;
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      anySucceeded = true;
    } else {
      errors.push(r.reason?.message || String(r.reason));
      logger.warn('Azure discovery sub-task failed', { error: r.reason?.message });
    }
  }

  if (!anySucceeded && errors.length > 0) {
    throw new Error(`Azure discovery failed: ${errors[0]}`);
  }

  return {
    provider: 'azure',
    services,
    assets,
    recommended_alerts: [
      'VM CPU utilization > 80%',
      'SQL Database DTU consumption > 90%',
      'AKS pod restart count > 5 in 10m',
      'App Service HTTP 5xx rate > 1%',
      'Storage Account availability < 99.9%',
    ],
    recommended_dashboards: [
      'Azure Infrastructure Overview',
      'Virtual Machine Fleet Health',
      'SQL Database Performance',
      'AKS Cluster Health',
      'App Service Performance',
    ],
  };
}

async function discoverVMs(
  credential: ClientSecretCredential,
  subId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const client = new ComputeManagementClient(credential, subId);
  const vms: any[] = [];
  try {
    for await (const vm of client.virtualMachines.listAll()) {
      vms.push(vm);
    }
  } catch (err: any) {
    throw wrapAzureError('Virtual Machines list', err);
  }

  services.push({
    service_type: 'virtual_machines',
    display_name: 'Virtual Machines',
    count: vms.length,
    details: `${vms.length} VM${vms.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: vms.length > 20,
  });

  if (vms.length > 10) {
    assets.push(
      makeAsset({
        name: `${vms.length} Virtual Machines`,
        provider: 'azure',
        category: 'compute',
        resource_type: 'virtual_machines',
        region: '',
        cloud_id: `aggregate:virtual_machines:${subId}`,
        cloud_account_id: subId,
        is_aggregate: true,
        aggregate_count: vms.length,
      }),
    );
  } else {
    for (const vm of vms) {
      assets.push(
        makeAsset({
          name: vm.name || 'unnamed',
          provider: 'azure',
          category: 'compute',
          resource_type: 'virtual_machines',
          region: vm.location || '',
          cloud_id: vm.id || '',
          cloud_account_id: subId,
          metadata: {
            vm_size: vm.hardwareProfile?.vmSize,
            os_type: vm.storageProfile?.osDisk?.osType,
            provisioning_state: vm.provisioningState,
          },
          status: vm.provisioningState === 'Succeeded' ? 'healthy' : 'degraded',
        }),
      );
    }
  }
}

async function discoverAKS(
  credential: ClientSecretCredential,
  subId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const client = new ContainerServiceClient(credential, subId);
  const clusters: any[] = [];
  try {
    for await (const c of client.managedClusters.list()) {
      clusters.push(c);
    }
  } catch (err: any) {
    throw wrapAzureError('AKS managedClusters.list', err);
  }

  services.push({
    service_type: 'aks',
    display_name: 'AKS Clusters',
    count: clusters.length,
    details: `${clusters.length} cluster${clusters.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  for (const c of clusters) {
    const status = c.provisioningState === 'Succeeded' ? 'healthy' : 'degraded';
    assets.push(
      makeAsset({
        name: c.name || 'unnamed',
        provider: 'azure',
        category: 'kubernetes',
        resource_type: 'aks',
        region: c.location || '',
        cloud_id: c.id || '',
        cloud_account_id: subId,
        metadata: {
          version: c.kubernetesVersion,
          node_count: (c.agentPoolProfiles || []).reduce(
            (sum: number, p: any) => sum + (p.count || 0),
            0,
          ),
          fqdn: c.fqdn,
        },
        status,
        status_reason: status !== 'healthy' ? `Provisioning: ${c.provisioningState}` : null,
      }),
    );
  }
}

async function discoverSQL(
  credential: ClientSecretCredential,
  subId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const client = new SqlManagementClient(credential, subId);
  const servers: any[] = [];
  try {
    for await (const s of client.servers.list()) {
      servers.push(s);
    }
  } catch (err: any) {
    throw wrapAzureError('SQL servers.list', err);
  }

  services.push({
    service_type: 'sql_database',
    display_name: 'SQL Servers',
    count: servers.length,
    details: `${servers.length} server${servers.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: false,
  });

  for (const s of servers) {
    assets.push(
      makeAsset({
        name: s.name || 'unnamed',
        provider: 'azure',
        category: 'database',
        resource_type: 'sql_server',
        region: s.location || '',
        cloud_id: s.id || '',
        cloud_account_id: subId,
        metadata: {
          version: s.version,
          fully_qualified_domain_name: s.fullyQualifiedDomainName,
          state: s.state,
        },
        status: s.state === 'Ready' ? 'healthy' : 'degraded',
      }),
    );
  }
}

async function discoverStorage(
  credential: ClientSecretCredential,
  subId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const client = new StorageManagementClient(credential, subId);
  const accounts: any[] = [];
  try {
    for await (const a of client.storageAccounts.list()) {
      accounts.push(a);
    }
  } catch (err: any) {
    throw wrapAzureError('Storage accounts list', err);
  }

  if (accounts.length === 0) return;

  services.push({
    service_type: 'storage_accounts',
    display_name: 'Storage Accounts',
    count: accounts.length,
    details: `${accounts.length} account${accounts.length !== 1 ? 's' : ''}`,
    recommended: false,
    high_cardinality: true,
  });

  assets.push(
    makeAsset({
      name: `${accounts.length} Storage Accounts`,
      provider: 'azure',
      category: 'storage',
      resource_type: 'storage_accounts',
      region: '',
      cloud_id: `aggregate:storage_accounts:${subId}`,
      cloud_account_id: subId,
      is_aggregate: true,
      aggregate_count: accounts.length,
    }),
  );
}

async function discoverAppServices(
  credential: ClientSecretCredential,
  subId: string,
  assets: DiscoveredAsset[],
  services: DiscoveredService[],
) {
  const client = new WebSiteManagementClient(credential, subId);
  const apps: any[] = [];
  try {
    for await (const a of client.webApps.list()) {
      apps.push(a);
    }
  } catch (err: any) {
    throw wrapAzureError('App Services webApps.list', err);
  }

  if (apps.length === 0) return;

  services.push({
    service_type: 'app_service',
    display_name: 'App Services',
    count: apps.length,
    details: `${apps.length} app${apps.length !== 1 ? 's' : ''}`,
    recommended: true,
    high_cardinality: apps.length > 20,
  });

  if (apps.length > 15) {
    assets.push(
      makeAsset({
        name: `${apps.length} App Services`,
        provider: 'azure',
        category: 'app_platform',
        resource_type: 'app_service',
        region: '',
        cloud_id: `aggregate:app_service:${subId}`,
        cloud_account_id: subId,
        is_aggregate: true,
        aggregate_count: apps.length,
      }),
    );
  } else {
    for (const a of apps) {
      assets.push(
        makeAsset({
          name: a.name || 'unnamed',
          provider: 'azure',
          category: 'app_platform',
          resource_type: 'app_service',
          region: a.location || '',
          cloud_id: a.id || '',
          cloud_account_id: subId,
          metadata: {
            state: a.state,
            default_host_name: a.defaultHostName,
            kind: a.kind,
          },
          status: a.state === 'Running' ? 'healthy' : 'degraded',
        }),
      );
    }
  }
}
