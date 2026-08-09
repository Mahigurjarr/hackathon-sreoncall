import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetAccessToken,
  mockGetClient,
  mockAggregatedList,
  mockClustersList,
  mockSqlList,
  mockRunList,
  mockBucketsList,
  mockGetToken,
  mockVmListAll,
  mockAksList,
  mockSqlServersList,
  mockStorageList,
  mockAppList,
} = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockGetClient: vi.fn(),
  mockAggregatedList: vi.fn(),
  mockClustersList: vi.fn(),
  mockSqlList: vi.fn(),
  mockRunList: vi.fn(),
  mockBucketsList: vi.fn(),
  mockGetToken: vi.fn(),
  mockVmListAll: vi.fn(),
  mockAksList: vi.fn(),
  mockSqlServersList: vi.fn(),
  mockStorageList: vi.fn(),
  mockAppList: vi.fn(),
}));

function asyncIterFrom(items: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const i of items) yield i;
    },
  };
}

vi.mock('googleapis', () => {
  class FakeGoogleAuth {
    getClient: any;
    constructor() {
      this.getClient = mockGetClient;
    }
  }
  return {
    google: {
      auth: { GoogleAuth: FakeGoogleAuth },
      compute: () => ({ instances: { aggregatedList: mockAggregatedList } }),
      container: () => ({
        projects: { locations: { clusters: { list: mockClustersList } } },
      }),
      sqladmin: () => ({ instances: { list: mockSqlList } }),
      run: () => ({
        projects: { locations: { services: { list: mockRunList } } },
      }),
      storage: () => ({ buckets: { list: mockBucketsList } }),
    },
  };
});

vi.mock('@azure/identity', () => {
  class ClientSecretCredential {
    getToken = mockGetToken;
  }
  return { ClientSecretCredential };
});

vi.mock('@azure/arm-compute', () => {
  class ComputeManagementClient {
    virtualMachines = { listAll: () => asyncIterFrom(mockVmListAll()) };
  }
  return { ComputeManagementClient };
});

vi.mock('@azure/arm-containerservice', () => {
  class ContainerServiceClient {
    managedClusters = { list: () => asyncIterFrom(mockAksList()) };
  }
  return { ContainerServiceClient };
});

vi.mock('@azure/arm-sql', () => {
  class SqlManagementClient {
    servers = { list: () => asyncIterFrom(mockSqlServersList()) };
  }
  return { SqlManagementClient };
});

vi.mock('@azure/arm-storage', () => {
  class StorageManagementClient {
    storageAccounts = { list: () => asyncIterFrom(mockStorageList()) };
  }
  return { StorageManagementClient };
});

vi.mock('@azure/arm-appservice', () => {
  class WebSiteManagementClient {
    webApps = { list: () => asyncIterFrom(mockAppList()) };
  }
  return { WebSiteManagementClient };
});

// Import AFTER mocks are registered
import { discoverGCPReal } from '../gcp-discovery.service';
import { discoverAzureReal } from '../azure-discovery.service';
import { discoverCloudServices } from '../cloud-discovery.service';

const validGcpCreds = {
  service_account_json: JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'sa@test.iam.gserviceaccount.com',
    // Synthetic test fixture only — built via concat so secret-scanners
    // don't pattern-match the assembled PEM block as a real credential.
    private_key: ['-----BEGIN ', 'PRIVATE KEY-----\n', 'TEST_FIXTURE_NOT_A_REAL_KEY\n', '-----END ', 'PRIVATE KEY-----\n'].join(''),
  }),
};

const validAzureCreds = {
  tenant_id: 'tenant-1',
  client_id: 'client-1',
  client_secret: 'secret-1',
  subscription_id: 'sub-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: auth succeeds
  mockGetClient.mockResolvedValue({ getAccessToken: mockGetAccessToken });
  mockGetAccessToken.mockResolvedValue({ token: 'fake-token' });
  mockGetToken.mockResolvedValue({ token: 'fake-token', expiresOnTimestamp: Date.now() + 60_000 });
  // Default: all discovery calls return empty
  mockAggregatedList.mockResolvedValue({ data: { items: {} } });
  mockClustersList.mockResolvedValue({ data: { clusters: [] } });
  mockSqlList.mockResolvedValue({ data: { items: [] } });
  mockRunList.mockResolvedValue({ data: { services: [] } });
  mockBucketsList.mockResolvedValue({ data: { items: [] } });
  mockVmListAll.mockReturnValue([]);
  mockAksList.mockReturnValue([]);
  mockSqlServersList.mockReturnValue([]);
  mockStorageList.mockReturnValue([]);
  mockAppList.mockReturnValue([]);
});

describe('GCP discovery', () => {
  it('throws on missing credentials', async () => {
    await expect(discoverCloudServices('gcp', {})).rejects.toThrow(/GCP credentials required/);
  });

  it('throws on malformed service_account_json', async () => {
    await expect(
      discoverGCPReal({ service_account_json: 'not json' }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws on service_account_json missing client_email', async () => {
    await expect(
      discoverGCPReal({
        service_account_json: JSON.stringify({ project_id: 'p', private_key: 'k' }),
      }),
    ).rejects.toThrow(/missing required fields/);
  });

  it('propagates GCP auth failure from getAccessToken', async () => {
    mockGetAccessToken.mockRejectedValue(
      Object.assign(new Error('invalid_grant: Invalid JWT Signature'), { code: 401 }),
    );
    await expect(discoverGCPReal(validGcpCreds)).rejects.toThrow(/authentication failed/i);
  });

  it('returns result with discovered GCE + GKE + Cloud SQL + Cloud Run + GCS assets', async () => {
    mockAggregatedList.mockResolvedValue({
      data: {
        items: {
          'zones/us-central1-a': {
            instances: [
              {
                name: 'vm-1',
                status: 'RUNNING',
                machineType: 'projects/p/zones/us-central1-a/machineTypes/e2-standard-4',
                networkInterfaces: [{ networkIP: '10.0.0.1' }],
              },
            ],
          },
        },
      },
    });
    mockClustersList.mockResolvedValue({
      data: {
        clusters: [
          { name: 'gke-1', location: 'us-central1', status: 'RUNNING', currentMasterVersion: '1.29', currentNodeCount: 3 },
        ],
      },
    });
    mockSqlList.mockResolvedValue({
      data: {
        items: [
          {
            name: 'db-1',
            region: 'us-central1',
            state: 'RUNNABLE',
            databaseVersion: 'POSTGRES_15',
            settings: { tier: 'db-custom-2-8192' },
          },
        ],
      },
    });
    mockRunList.mockResolvedValue({
      data: {
        services: [
          {
            name: 'projects/test-project/locations/us-central1/services/api-svc',
            uri: 'https://api-svc.run.app',
            latestReadyRevision: 'api-svc-00001',
          },
        ],
      },
    });
    mockBucketsList.mockResolvedValue({
      data: { items: [{ name: 'bucket-1' }, { name: 'bucket-2' }] },
    });

    const result = await discoverGCPReal(validGcpCreds);
    expect(result.provider).toBe('gcp');
    expect(result.assets.length).toBeGreaterThan(0);
    expect(result.services.map((s) => s.service_type).sort()).toEqual(
      ['cloud_run', 'cloud_sql', 'cloud_storage', 'compute_engine', 'gke'].sort(),
    );
    expect(result.assets.find((a) => a.resource_type === 'compute_engine')).toBeTruthy();
    expect(result.assets.find((a) => a.resource_type === 'gke')).toBeTruthy();
    expect(result.assets.find((a) => a.resource_type === 'cloud_sql')).toBeTruthy();
    expect(result.assets.find((a) => a.resource_type === 'cloud_run')).toBeTruthy();
    expect(result.recommended_alerts.length).toBeGreaterThan(0);
  });
});

describe('Azure discovery', () => {
  it('throws on missing credentials', async () => {
    await expect(discoverCloudServices('azure', {})).rejects.toThrow(/Azure credentials required/);
  });

  it('throws on missing subscription_id specifically', async () => {
    await expect(
      discoverAzureReal({
        tenant_id: 't',
        client_id: 'c',
        client_secret: 's',
      }),
    ).rejects.toThrow(/subscription_id/);
  });

  it('propagates Azure auth failure from getToken', async () => {
    mockGetToken.mockRejectedValue(
      Object.assign(new Error('AADSTS7000215: Invalid client secret provided'), { code: 401 }),
    );
    await expect(discoverAzureReal(validAzureCreds)).rejects.toThrow(/authentication failed/i);
  });

  it('returns result with discovered VMs + AKS + SQL + Storage + App Services', async () => {
    mockVmListAll.mockReturnValue([
      {
        id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-1',
        name: 'vm-1',
        location: 'eastus',
        provisioningState: 'Succeeded',
        hardwareProfile: { vmSize: 'Standard_D2s_v3' },
        storageProfile: { osDisk: { osType: 'Linux' } },
      },
    ]);
    mockAksList.mockReturnValue([
      {
        id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/aks-1',
        name: 'aks-1',
        location: 'eastus',
        provisioningState: 'Succeeded',
        kubernetesVersion: '1.29',
        agentPoolProfiles: [{ count: 3 }],
      },
    ]);
    mockSqlServersList.mockReturnValue([
      {
        id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Sql/servers/sql-1',
        name: 'sql-1',
        location: 'eastus',
        state: 'Ready',
        version: '12.0',
        fullyQualifiedDomainName: 'sql-1.database.windows.net',
      },
    ]);
    mockStorageList.mockReturnValue([
      { id: '/sa-1', name: 'sa1', location: 'eastus' },
      { id: '/sa-2', name: 'sa2', location: 'eastus' },
    ]);
    mockAppList.mockReturnValue([
      {
        id: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Web/sites/app-1',
        name: 'app-1',
        location: 'eastus',
        state: 'Running',
        defaultHostName: 'app-1.azurewebsites.net',
        kind: 'app',
      },
    ]);

    const result = await discoverAzureReal(validAzureCreds);
    expect(result.provider).toBe('azure');
    expect(result.assets.length).toBeGreaterThan(0);
    expect(result.services.map((s) => s.service_type).sort()).toEqual(
      ['aks', 'app_service', 'sql_database', 'storage_accounts', 'virtual_machines'].sort(),
    );
    expect(result.assets.find((a) => a.resource_type === 'virtual_machines')).toBeTruthy();
    expect(result.assets.find((a) => a.resource_type === 'aks')).toBeTruthy();
    expect(result.assets.find((a) => a.resource_type === 'sql_server')).toBeTruthy();
    expect(result.assets.find((a) => a.resource_type === 'app_service')).toBeTruthy();
  });
});
