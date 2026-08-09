import { DiscoveredAsset } from './cloud-discovery.service';
import { logger } from '../utils/logger';

const QUERY_TIMEOUT_MS = 15_000;

interface PromQueryResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: [number, string][];
    }>;
  };
}

/**
 * Query Mimir's Prometheus-compatible API for instant vector results.
 */
async function promQuery(metricsUrl: string, orgId: string, query: string): Promise<PromQueryResult['data']['result']> {
  const url = `${metricsUrl}/prometheus/api/v1/query?query=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, {
      headers: { 'X-Scope-OrgID': orgId, Accept: 'application/json' },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!resp.ok) {
      logger.warn('Mimir query failed', { status: resp.status, query });
      return [];
    }
    const body: PromQueryResult = await resp.json() as PromQueryResult;
    return body.data?.result ?? [];
  } catch (err: any) {
    logger.warn('Mimir query error', { query, error: err.message });
    return [];
  }
}

function makeAsset(overrides: Partial<DiscoveredAsset> & Pick<DiscoveredAsset, 'name' | 'provider' | 'category' | 'resource_type' | 'cloud_id'>): DiscoveredAsset {
  // NOTE: `region` falls back to 'on-premise' only when the caller does not
  // override it. discoverFromLgtm() threads a `defaultRegion` through to the
  // strategy helpers so cloud-hosted LGTM assets inherit e.g. 'fr-par'
  // instead of the legacy on-premise default.
  return {
    region: 'on-premise',
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

export interface LgtmDiscoveryResult {
  assets: DiscoveredAsset[];
  summary: {
    nodes: number;
    namespaces: number;
    workloads: number;
    has_kubernetes: boolean;
  };
}

/**
 * Extract workload name and kind from a K8s pod name.
 * Pod naming conventions:
 *   Deployment:   <deploy>-<replicaset-hash>-<pod-hash>    (e.g., coredns-697968c856-86rv9)
 *   StatefulSet:  <sts>-<ordinal>                          (e.g., alertmanager-kube-prometheus-stack-alertmanager-0)
 *   DaemonSet:    <ds>-<pod-hash>                          (e.g., sreoncall-agent-alloy-5b527)
 *   Job/CronJob:  <job>-<random>                           (e.g., backup-job-28456-xjk2s)
 */
function inferWorkloadFromPod(podName: string): { name: string; kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' } {
  // StatefulSet: ends with -<number>
  const stsMatch = podName.match(/^(.+)-(\d+)$/);
  if (stsMatch) {
    return { name: stsMatch[1], kind: 'StatefulSet' };
  }

  // Deployment or DaemonSet: remove trailing hash segments
  // Deployment pods have 2 trailing hashes: <name>-<rs-hash>-<pod-hash>
  const parts = podName.split('-');
  if (parts.length >= 3) {
    // Check if last two segments look like hashes (5-10 alphanumeric chars)
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    const isHash = (s: string) => /^[a-z0-9]{4,10}$/.test(s);

    if (isHash(last) && isHash(secondLast)) {
      // Deployment: <name>-<rs-hash>-<pod-hash>
      return { name: parts.slice(0, -2).join('-'), kind: 'Deployment' };
    }
    if (isHash(last)) {
      // DaemonSet: <name>-<pod-hash>
      return { name: parts.slice(0, -1).join('-'), kind: 'DaemonSet' };
    }
  }

  return { name: podName, kind: 'Deployment' };
}

/**
 * Discover infrastructure assets by querying Mimir for Prometheus metrics.
 *
 * Uses a multi-strategy approach:
 * 1. **kube-state-metrics** (kube_node_info, kube_deployment_spec_replicas, etc.)
 *    — provides rich K8s metadata with replica counts
 * 2. **Cadvisor/kubelet fallback** (container_cpu_usage_seconds_total, kubelet_node_name)
 *    — extracts workloads from container metrics when kube-state-metrics is unavailable
 * 3. **node_exporter** (node_uname_info)
 *    — discovers standalone VMs not part of a K8s cluster
 */
/**
 * Provider-agnostic map of "fingerprint → cloud_id" for assets the worker
 * has already discovered via a cloud SDK. LGTM discovery consults this
 * map before pushing a synthetic lgtm-… asset; on a hit, it reuses the
 * cloud SDK's cloud_id (so workloads re-parent correctly and we never
 * create a duplicate row for the same logical thing).
 *
 * Fingerprints are built via `assetFingerprint()` below, which groups
 * cross-provider resource_types into logical buckets (`k8s_cluster`,
 * `vm`) so an EKS/GKE/AKS/Kapsule cluster collides on the same key and
 * a Scaleway/AWS/GCP/Azure/DO VM collides by hostname.
 */
export type AssetIdentityMap = Map<string, string>;

const K8S_CLUSTER_RESOURCE_TYPES = ['k8s_cluster', 'kapsule', 'eks', 'gke', 'aks', 'doks'];
const VM_RESOURCE_TYPES = ['vm', 'scw_instance', 'ec2', 'droplet', 'virtual_machines', 'compute_engine'];
const DATABASE_RESOURCE_TYPES = ['database', 'rdb', 'rds', 'cloud_sql', 'sql_server'];
const LB_RESOURCE_TYPES = ['loadbalancer', 'scw_lb', 'alb', 'nlb', 'elb', 'do_lb', 'azure_lb', 'gcp_lb'];
const APP_SERVICE_RESOURCE_TYPES = [
  'application_service',
  'scw_functions', 'scw_containers',
  'lambda',
  'cloud_run',
  'app_service',
  'do_app', 'do_functions',
];

/**
 * Normalize (category, resource_type, name) into a provider-agnostic
 * fingerprint key. Same-bucket resource types collapse so identity is
 * preserved across cloud providers.
 */
export function assetFingerprint(category: string, resourceType: string, name: string): string {
  const bucket = categoryBucket(category, resourceType);
  return `${bucket}:${name.toLowerCase()}`;
}

function categoryBucket(category: string, resourceType: string): string {
  if (category === 'kubernetes' && K8S_CLUSTER_RESOURCE_TYPES.includes(resourceType)) return 'k8s_cluster';
  if (category === 'compute' && VM_RESOURCE_TYPES.includes(resourceType)) return 'vm';
  // DigitalOcean DB resource_types carry an engine suffix (do_db_postgres,
  // do_db_mysql, …) so match on prefix as well as the exact list.
  if (category === 'database' && (DATABASE_RESOURCE_TYPES.includes(resourceType) || resourceType.startsWith('do_db_'))) return 'database';
  if (category === 'networking' && LB_RESOURCE_TYPES.includes(resourceType)) return 'loadbalancer';
  if ((category === 'serverless' || category === 'compute' || category === 'app_platform')
      && APP_SERVICE_RESOURCE_TYPES.includes(resourceType)) return 'application_service';
  return `${category}:${resourceType}`;
}

/**
 * Build an identity map from a list of discovered assets. Aggregate rows
 * (no individual name) are skipped.
 */
export function buildAssetIdentityMap(assets: DiscoveredAsset[]): AssetIdentityMap {
  const map: AssetIdentityMap = new Map();
  for (const a of assets) {
    if (a.is_aggregate) continue;
    map.set(assetFingerprint(a.category, a.resource_type, a.name), a.cloud_id);
  }
  return map;
}

/**
 * Heuristic fallback: if the identity map contains exactly one
 * k8s_cluster fingerprint, return its cloud_id. Used when the Alloy
 * cluster label does not match the cloud-SDK cluster name (e.g. Alloy
 * emits `cluster=k8s-cluster` while the Scaleway Kapsule is named
 * `tpk-prod`) so dedup still works.
 */
function soleManagedClusterCloudId(identityMap?: AssetIdentityMap): string | undefined {
  if (!identityMap) return undefined;
  const clusterIds: string[] = [];
  for (const [k, v] of identityMap) {
    if (k.startsWith('k8s_cluster:')) clusterIds.push(v);
  }
  return clusterIds.length === 1 ? clusterIds[0] : undefined;
}

export async function discoverFromLgtm(
  metricsUrl: string,
  orgId: string,
  cloudProvider?: string,
  identityMap?: AssetIdentityMap,
  defaultRegion?: string,
): Promise<LgtmDiscoveryResult> {
  const provider = (cloudProvider || 'self_managed') as DiscoveredAsset['provider'];
  const region = defaultRegion || 'on-premise';
  const assets: DiscoveredAsset[] = [];
  let clusterCloudId: string | null = null;
  let usedKubeStateMetrics = false;

  // ── Strategy 1: Try kube-state-metrics first ──
  const ksmNodeResults = await promQuery(metricsUrl, orgId, 'kube_node_info');

  if (ksmNodeResults.length > 0) {
    usedKubeStateMetrics = true;
    clusterCloudId = await discoverViaKubeStateMetrics(metricsUrl, orgId, ksmNodeResults, assets, provider, identityMap, region);
  }

  // ── Strategy 2: Cadvisor/kubelet fallback ──
  if (!usedKubeStateMetrics) {
    // Check for kubelet or cadvisor container metrics
    const kubeletNodes = await promQuery(metricsUrl, orgId, 'kubelet_node_name');
    const containerMetrics = await promQuery(
      metricsUrl, orgId,
      'count by (namespace, pod) (container_cpu_usage_seconds_total{container!="", container!="POD"})',
    );

    if (kubeletNodes.length > 0 || containerMetrics.length > 0) {
      clusterCloudId = await discoverViaCadvisor(metricsUrl, orgId, kubeletNodes, containerMetrics, assets, provider, identityMap, region);
    }
  }

  // ── Strategy 3: Standalone VMs via node_exporter ──
  const nodeUnameResults = await promQuery(metricsUrl, orgId, 'node_uname_info');
  const k8sNodeNames = new Set(assets.filter(a => a.category === 'compute').map(a => a.name.toLowerCase()));
  const k8sWorkloadNames = new Set(assets.filter(a => a.k8s_namespace !== null).map(a => a.name.toLowerCase()));

  for (const r of nodeUnameResults) {
    const instance = r.metric.instance ?? '';
    const nodename = r.metric.nodename ?? '';
    const sysname = r.metric.sysname ?? '';
    const release = r.metric.release ?? '';
    const machine = r.metric.machine ?? '';

    const name = nodename || instance.split(':')[0] || 'unknown-host';
    const lowerName = name.toLowerCase();

    // Skip if already discovered as a K8s node
    if (k8sNodeNames.has(lowerName)) continue;

    // Skip if this looks like a K8s pod (matched by workload prefix)
    // e.g., node_uname_info from Alloy running as a DaemonSet pod
    const isK8sPod = [...k8sWorkloadNames].some(wn => lowerName.startsWith(wn));
    if (isK8sPod) continue;

    // Skip if the cloud SDK already discovered this VM (scw_instance, ec2,
    // droplet, etc.) — the cloud-SDK row is canonical, no need to push an
    // lgtm-vm duplicate under a different cloud_id.
    if (identityMap?.has(assetFingerprint('compute', 'vm', name))) continue;

    assets.push(makeAsset({
      name,
      provider,
      category: 'compute',
      resource_type: 'vm',
      cloud_id: `lgtm-vm:${orgId}:${name}`,
      cloud_account_id: orgId,
      region,
      metadata: { instance, os: sysname, kernel: release, arch: machine },
    }));
  }

  // ── Strategy 4: SNMP network devices via snmp-trapper ──
  const [snmpDeviceResults, snmpIfCountResults, snmpLldpResults, snmpBgpResults, snmpChassisResults] = await Promise.all([
    promQuery(metricsUrl, orgId, 'last_over_time(snmp_device_info[2h])'),
    promQuery(metricsUrl, orgId, 'last_over_time(snmp_device_interface_count[2h])'),
    promQuery(metricsUrl, orgId, 'last_over_time(snmp_lldp_neighbor_count[2h])'),
    promQuery(metricsUrl, orgId, 'last_over_time(snmp_bgp_peer_count[2h])'),
    promQuery(metricsUrl, orgId, 'last_over_time(snmp_entity_chassis_info[2h])'),
  ]);

  // Build lookup maps by device IP
  const ifCounts: Record<string, number> = {};
  for (const r of snmpIfCountResults) {
    ifCounts[r.metric.device ?? ''] = parseInt(r.value?.[1] ?? '0', 10);
  }
  const lldpNeighborCounts: Record<string, number> = {};
  for (const r of snmpLldpResults) {
    lldpNeighborCounts[r.metric.device ?? ''] = parseInt(r.value?.[1] ?? '0', 10);
  }
  const bgpPeerCounts: Record<string, number> = {};
  for (const r of snmpBgpResults) {
    bgpPeerCounts[r.metric.device ?? ''] = parseInt(r.value?.[1] ?? '0', 10);
  }
  const chassisInfo: Record<string, { model: string; serial: string }> = {};
  for (const r of snmpChassisResults) {
    const dev = r.metric.device ?? '';
    chassisInfo[dev] = { model: r.metric.model ?? '', serial: r.metric.serial ?? '' };
  }

  for (const r of snmpDeviceResults) {
    const ip = r.metric.device ?? '';
    const sysName = r.metric.sysname ?? '';
    const sysDescr = r.metric.sysdescr ?? '';
    const sysObjectID = r.metric.sysobjectid ?? '';
    const sysLocation = r.metric.syslocation ?? '';
    const sysContact = r.metric.syscontact ?? '';
    const name = sysName || ip || 'unknown-device';

    // Skip if already discovered as a compute node
    if (k8sNodeNames.has(name.toLowerCase())) continue;

    // Use device_type from the trapper's classification label, fall back to local classification
    const deviceType = r.metric.device_type || classifyDeviceType(sysDescr, sysObjectID, ifCounts[ip] ?? 0, bgpPeerCounts[ip] ?? 0);
    const chassis = chassisInfo[ip];

    assets.push(makeAsset({
      name,
      provider,
      category: 'networking',
      resource_type: deviceType,
      cloud_id: `snmp-device:${orgId}:${ip}`,
      cloud_account_id: orgId,
      region: sysLocation || 'on-premise',
      metadata: {
        ip,
        sys_name: sysName,
        sys_descr: sysDescr,
        sys_object_id: sysObjectID,
        sys_location: sysLocation,
        sys_contact: sysContact,
        device_type: deviceType,
        interface_count: ifCounts[ip] ?? 0,
        lldp_neighbor_count: lldpNeighborCounts[ip] ?? 0,
        bgp_peer_count: bgpPeerCounts[ip] ?? 0,
        model: chassis?.model ?? '',
        serial: chassis?.serial ?? '',
        discovery_method: 'snmp',
      },
      status: 'healthy',
    }));
  }

  // ── Strategy 5: Beyla eBPF-discovered application services ──
  await discoverViaBeyla(metricsUrl, orgId, assets, assets, provider, identityMap, region);

  const workloads = assets.filter(a => a.k8s_namespace !== null);
  const nodes = assets.filter(a => a.category === 'compute');
  const networkDevices = assets.filter(a => a.category === 'networking');
  const appServices = assets.filter(a => a.resource_type === 'application_service');

  logger.info('LGTM discovery complete', {
    orgId,
    strategy: usedKubeStateMetrics ? 'kube-state-metrics' : 'cadvisor',
    totalAssets: assets.length,
    nodes: nodes.length,
    workloads: workloads.length,
    networkDevices: networkDevices.length,
    appServices: appServices.length,
    hasKubernetes: clusterCloudId !== null,
  });

  return {
    assets,
    summary: {
      nodes: nodes.length,
      namespaces: [...new Set(workloads.map(a => a.k8s_namespace))].length,
      workloads: workloads.length,
      has_kubernetes: clusterCloudId !== null,
    },
  };
}

/**
 * Classify SNMP device type based on sysDescr, sysObjectID, interface count, and BGP peers.
 * Returns a more specific resource_type than the generic 'snmp_device'.
 */
function classifyDeviceType(sysDescr: string, sysObjectID: string, ifCount: number, bgpPeerCount: number): string {
  const descLower = sysDescr.toLowerCase();

  // OLT/PON devices
  if (descLower.includes('olt') || descLower.includes('gepon') || descLower.includes('gpon') || descLower.includes('epon')) {
    return 'olt';
  }

  // Router indicators: BGP peers, or router in description
  if (bgpPeerCount > 0 || descLower.includes('router') || descLower.includes('routeros')) {
    return 'router';
  }

  // Firewall
  if (descLower.includes('firewall') || descLower.includes('fortigate') || descLower.includes('pfsense') || descLower.includes('palo alto')) {
    return 'firewall';
  }

  // Wireless AP / controller
  if (descLower.includes('wireless') || descLower.includes('access point') || descLower.includes('wap') || descLower.includes('unifi')) {
    return 'wireless_ap';
  }

  // MikroTik devices — classify by interface count and description
  if (descLower.includes('mikrotik') || descLower.includes('routeros')) {
    if (ifCount > 20) return 'router';
    return 'router';
  }

  // Switch: many interfaces (>8), or switch in description
  if (descLower.includes('switch') || ifCount > 8) {
    return 'switch';
  }

  // UPS / power
  if (descLower.includes('ups') || descLower.includes('apc ') || descLower.includes('power')) {
    return 'ups';
  }

  // Server / host with SNMP
  if (descLower.includes('linux') || descLower.includes('windows') || descLower.includes('server')) {
    return 'server';
  }

  return 'snmp_device';
}

/**
 * Strategy 1: Full kube-state-metrics discovery with replica counts.
 */
async function discoverViaKubeStateMetrics(
  metricsUrl: string,
  orgId: string,
  nodeInfoResults: PromQueryResult['data']['result'],
  assets: DiscoveredAsset[],
  provider: DiscoveredAsset['provider'],
  identityMap?: AssetIdentityMap,
  region: string = 'on-premise',
): Promise<string> {
  const clusterLabel = nodeInfoResults[0]?.metric?.cluster || 'k8s-cluster';
  // Reuse an existing cloud-SDK cluster cloud_id when the fingerprint matches
  // directly, OR fall back to "tenant has exactly one managed cluster in the
  // identity map" heuristic. The latter handles the common case where Alloy
  // doesn't set a `cluster` label that matches the cloud-SDK cluster name
  // (so kube_node_info defaults to `k8s-cluster` while the Scaleway/EKS/GKE
  // cluster is actually named `tpk-prod` etc). Without this, name mismatch
  // would cause a duplicate `lgtm-k8s-cluster:…` row to be created every
  // tick despite the identity map mechanism.
  const existingClusterId = identityMap?.get(assetFingerprint('kubernetes', 'k8s_cluster', clusterLabel))
    ?? soleManagedClusterCloudId(identityMap);
  const clusterCloudId = existingClusterId ?? `lgtm-k8s-cluster:${orgId}:${clusterLabel}`;

  const nodeNames = [...new Set(nodeInfoResults.map(r => r.metric.node))].filter(Boolean);
  const kernelVersions = [...new Set(nodeInfoResults.map(r => r.metric.kernel_version))].filter(Boolean);
  const osImages = [...new Set(nodeInfoResults.map(r => r.metric.os_image))].filter(Boolean);

  const [podResults, containerResults] = await Promise.all([
    promQuery(metricsUrl, orgId, 'count(kube_pod_info)'),
    promQuery(metricsUrl, orgId, 'count(kube_pod_container_info)'),
  ]);

  const podCount = podResults.length > 0 ? parseInt(podResults[0]?.value?.[1] ?? '0', 10) : 0;
  const containerCount = containerResults.length > 0 ? parseInt(containerResults[0]?.value?.[1] ?? '0', 10) : 0;

  // Skip pushing a duplicate cluster asset when the cloud SDK already
  // discovered one — children will reparent onto the existing cluster.
  if (!existingClusterId) {
    assets.push(makeAsset({
      name: clusterLabel,
      provider,
      category: 'kubernetes',
      resource_type: 'k8s_cluster',
      cloud_id: clusterCloudId,
      cloud_account_id: orgId,
      region,
      metadata: { node_count: nodeNames.length, pod_count: podCount, container_count: containerCount, kernel: kernelVersions[0] ?? 'unknown', os_image: osImages[0] ?? 'unknown' },
    }));
  }

  // Nodes — skip each one that the cloud SDK already discovered as a VM
  // (scw_instance, ec2, droplet, etc.); the cloud-SDK row is canonical.
  for (const r of nodeInfoResults) {
    const nodeName = r.metric.node;
    if (!nodeName) continue;
    if (identityMap?.has(assetFingerprint('compute', 'vm', nodeName))) continue;
    const role = nodeName.toLowerCase().includes('master') || nodeName.toLowerCase().includes('control') ? 'control-plane' : 'worker';
    assets.push(makeAsset({
      name: nodeName, provider, category: 'compute', resource_type: 'vm',
      cloud_id: `lgtm-node:${orgId}:${nodeName}`, cloud_account_id: orgId,
      region,
      metadata: { role, internal_ip: r.metric.internal_ip ?? '', kubelet_version: r.metric.kubelet_version ?? '', kernel: r.metric.kernel_version ?? '', os_image: r.metric.os_image ?? '' },
    }));
  }

  // Deployments
  const [deployResults, deployReadyResults] = await Promise.all([
    promQuery(metricsUrl, orgId, 'kube_deployment_spec_replicas'),
    promQuery(metricsUrl, orgId, 'kube_deployment_status_replicas_ready'),
  ]);
  const deployReady: Record<string, number> = {};
  for (const r of deployReadyResults) deployReady[`${r.metric.namespace}/${r.metric.deployment}`] = parseInt(r.value?.[1] ?? '0', 10);

  for (const r of deployResults) {
    const ns = r.metric.namespace, name = r.metric.deployment;
    if (!ns || !name) continue;
    const desired = parseInt(r.value?.[1] ?? '0', 10);
    const ready = deployReady[`${ns}/${name}`] ?? 0;
    assets.push(makeAsset({
      name, provider, category: 'kubernetes', resource_type: 'k8s_deployment',
      cloud_id: `lgtm-k8s:${orgId}/${ns}/deployment/${name}`, cloud_account_id: orgId,
      region,
      parent_cloud_id: clusterCloudId, k8s_namespace: ns, k8s_kind: 'Deployment',
      k8s_replicas_desired: desired, k8s_replicas_ready: ready,
      status: ready >= desired ? 'healthy' : ready === 0 ? 'unhealthy' : 'degraded',
      status_reason: ready < desired ? `${ready}/${desired} replicas ready` : null,
      metadata: { namespace: ns, kind: 'Deployment' },
    }));
  }

  // StatefulSets
  const [stsResults, stsReadyResults] = await Promise.all([
    promQuery(metricsUrl, orgId, 'kube_statefulset_replicas'),
    promQuery(metricsUrl, orgId, 'kube_statefulset_status_replicas_ready'),
  ]);
  const stsReady: Record<string, number> = {};
  for (const r of stsReadyResults) stsReady[`${r.metric.namespace}/${r.metric.statefulset}`] = parseInt(r.value?.[1] ?? '0', 10);

  for (const r of stsResults) {
    const ns = r.metric.namespace, name = r.metric.statefulset;
    if (!ns || !name) continue;
    const desired = parseInt(r.value?.[1] ?? '0', 10);
    const ready = stsReady[`${ns}/${name}`] ?? 0;
    assets.push(makeAsset({
      name, provider, category: 'kubernetes', resource_type: 'k8s_statefulset',
      cloud_id: `lgtm-k8s:${orgId}/${ns}/statefulset/${name}`, cloud_account_id: orgId,
      region,
      parent_cloud_id: clusterCloudId, k8s_namespace: ns, k8s_kind: 'StatefulSet',
      k8s_replicas_desired: desired, k8s_replicas_ready: ready,
      status: ready >= desired ? 'healthy' : ready === 0 ? 'unhealthy' : 'degraded',
      status_reason: ready < desired ? `${ready}/${desired} replicas ready` : null,
      metadata: { namespace: ns, kind: 'StatefulSet' },
    }));
  }

  // DaemonSets
  const [dsResults, dsReadyResults] = await Promise.all([
    promQuery(metricsUrl, orgId, 'kube_daemonset_status_desired_number_scheduled'),
    promQuery(metricsUrl, orgId, 'kube_daemonset_status_number_ready'),
  ]);
  const dsReady: Record<string, number> = {};
  for (const r of dsReadyResults) dsReady[`${r.metric.namespace}/${r.metric.daemonset}`] = parseInt(r.value?.[1] ?? '0', 10);

  for (const r of dsResults) {
    const ns = r.metric.namespace, name = r.metric.daemonset;
    if (!ns || !name) continue;
    const desired = parseInt(r.value?.[1] ?? '0', 10);
    const ready = dsReady[`${ns}/${name}`] ?? 0;
    assets.push(makeAsset({
      name, provider, category: 'kubernetes', resource_type: 'k8s_daemonset',
      cloud_id: `lgtm-k8s:${orgId}/${ns}/daemonset/${name}`, cloud_account_id: orgId,
      region,
      parent_cloud_id: clusterCloudId, k8s_namespace: ns, k8s_kind: 'DaemonSet',
      k8s_replicas_desired: desired, k8s_replicas_ready: ready,
      status: ready >= desired ? 'healthy' : ready === 0 ? 'unhealthy' : 'degraded',
      status_reason: ready < desired ? `${ready}/${desired} nodes ready` : null,
      metadata: { namespace: ns, kind: 'DaemonSet' },
    }));
  }

  // Pod-level issues
  const waitingResults = await promQuery(
    metricsUrl, orgId,
    'kube_pod_container_status_waiting_reason{reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerError"} > 0',
  );
  attachPodIssues(assets, waitingResults, clusterCloudId);

  return clusterCloudId;
}

/**
 * Strategy 2: Discover K8s workloads from cadvisor container metrics.
 * Groups pods by namespace and infers workload names from pod naming conventions.
 */
async function discoverViaCadvisor(
  metricsUrl: string,
  orgId: string,
  kubeletNodes: PromQueryResult['data']['result'],
  containerMetrics: PromQueryResult['data']['result'],
  assets: DiscoveredAsset[],
  provider: DiscoveredAsset['provider'],
  identityMap?: AssetIdentityMap,
  region: string = 'on-premise',
): Promise<string> {
  const clusterLabel = 'k8s-cluster';
  const existingClusterId = identityMap?.get(assetFingerprint('kubernetes', 'k8s_cluster', clusterLabel))
    ?? soleManagedClusterCloudId(identityMap);
  const clusterCloudId = existingClusterId ?? `lgtm-k8s-cluster:${orgId}:${clusterLabel}`;

  // Discover nodes from kubelet_node_name
  const nodeNames: string[] = [];
  for (const r of kubeletNodes) {
    const nodeName = r.metric.node ?? r.metric.instance ?? '';
    if (nodeName && !nodeNames.includes(nodeName)) nodeNames.push(nodeName);
  }

  // Count unique pods and namespaces from container metrics
  const pods = new Set<string>();
  const namespaces = new Set<string>();
  for (const r of containerMetrics) {
    const ns = r.metric.namespace;
    const pod = r.metric.pod;
    if (ns) namespaces.add(ns);
    if (pod) pods.add(`${ns}/${pod}`);
  }

  // Count containers
  const containerCountResults = await promQuery(
    metricsUrl, orgId,
    'count(container_cpu_usage_seconds_total{container!="", container!="POD"})',
  );
  const containerCount = containerCountResults.length > 0 ? parseInt(containerCountResults[0]?.value?.[1] ?? '0', 10) : 0;

  // Create cluster asset (skip if a managed cluster was already discovered
  // via the cloud SDK — children will reparent onto the existing cluster).
  if (!existingClusterId) {
    assets.push(makeAsset({
      name: clusterLabel,
      provider,
      category: 'kubernetes',
      resource_type: 'k8s_cluster',
      cloud_id: clusterCloudId,
      cloud_account_id: orgId,
      region,
      metadata: {
        node_count: nodeNames.length,
        pod_count: pods.size,
        container_count: containerCount,
        namespaces: namespaces.size,
        discovery_method: 'cadvisor',
      },
    }));
  }

  // Create node assets — skip any the cloud SDK already discovered as a VM
  for (const nodeName of nodeNames) {
    if (identityMap?.has(assetFingerprint('compute', 'vm', nodeName))) continue;
    const role = nodeName.toLowerCase().includes('master') || nodeName.toLowerCase().includes('control')
      ? 'control-plane' : 'worker';
    assets.push(makeAsset({
      name: nodeName,
      provider,
      category: 'compute',
      resource_type: 'vm',
      cloud_id: `lgtm-node:${orgId}:${nodeName}`,
      cloud_account_id: orgId,
      region,
      metadata: { role },
    }));
  }

  // Group pods by inferred workload
  const workloads: Record<string, {
    namespace: string;
    name: string;
    kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
    pods: string[];
  }> = {};

  for (const r of containerMetrics) {
    const ns = r.metric.namespace;
    const podName = r.metric.pod;
    if (!ns || !podName) continue;

    const { name, kind } = inferWorkloadFromPod(podName);
    const key = `${ns}/${kind}/${name}`;

    if (!workloads[key]) {
      workloads[key] = { namespace: ns, name, kind, pods: [] };
    }
    if (!workloads[key].pods.includes(podName)) {
      workloads[key].pods.push(podName);
    }
  }

  // Create workload assets
  for (const w of Object.values(workloads)) {
    const replicas = w.pods.length;
    assets.push(makeAsset({
      name: w.name,
      provider,
      category: 'kubernetes',
      resource_type: `k8s_${w.kind.toLowerCase()}`,
      cloud_id: `lgtm-k8s:${orgId}/${w.namespace}/${w.kind.toLowerCase()}/${w.name}`,
      cloud_account_id: orgId,
      region,
      parent_cloud_id: clusterCloudId,
      k8s_namespace: w.namespace,
      k8s_kind: w.kind,
      k8s_replicas_desired: replicas,
      k8s_replicas_ready: replicas, // from cadvisor we only see running pods
      metadata: { namespace: w.namespace, kind: w.kind, pod_count: replicas },
    }));
  }

  // Try pod-level issues from kubelet container waiting reasons
  const waitingResults = await promQuery(
    metricsUrl, orgId,
    'kube_pod_container_status_waiting_reason{reason=~"CrashLoopBackOff|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerError"} > 0',
  );
  if (waitingResults.length > 0) {
    attachPodIssues(assets, waitingResults, clusterCloudId);
  }

  return clusterCloudId;
}

/**
 * Attach pod-level issues to workload assets and update cluster status.
 */
function attachPodIssues(
  assets: DiscoveredAsset[],
  waitingResults: PromQueryResult['data']['result'],
  clusterCloudId: string,
): void {
  const podIssuesByWorkload: Record<string, string[]> = {};
  for (const r of waitingResults) {
    const ns = r.metric.namespace;
    const pod = r.metric.pod ?? '';
    const reason = r.metric.reason ?? 'unknown';
    const { name } = inferWorkloadFromPod(pod);
    const key = `${ns}/${name}`;
    if (!podIssuesByWorkload[key]) podIssuesByWorkload[key] = [];
    podIssuesByWorkload[key].push(reason);
  }

  for (const asset of assets) {
    if (asset.k8s_namespace && asset.k8s_kind) {
      const key = `${asset.k8s_namespace}/${asset.name}`;
      const issues = podIssuesByWorkload[key];
      if (issues) {
        const counts: Record<string, number> = {};
        for (const reason of issues) counts[reason] = (counts[reason] ?? 0) + 1;
        asset.k8s_pod_issues = Object.entries(counts).map(([reason, count]) => `${count} ${reason}`);
        asset.status = 'unhealthy';
        asset.status_reason = asset.k8s_pod_issues.join(', ');
      }
    }
  }

  const clusterAsset = assets.find(a => a.cloud_id === clusterCloudId);
  if (clusterAsset) {
    const unhealthyChildren = assets.filter(a => a.parent_cloud_id === clusterCloudId && a.status !== 'healthy');
    if (unhealthyChildren.length > 0) {
      clusterAsset.status = 'degraded';
      clusterAsset.status_reason = `${unhealthyChildren.length} workload(s) with issues`;
    }
  }
}

/**
 * Strategy 5: Discover application services from Beyla eBPF metrics.
 * Beyla emits http_server_request_duration_seconds with service_name labels.
 */
/**
 * Beyla's `service_name` label sometimes arrives in a doubled
 * `<name>;<namespace>` form because Beyla defaults service_namespace to
 * service_name when no explicit namespace is configured. `api-gw;api-gw`
 * → `api-gw`; `api-gw;prod` → `api-gw/prod`; `api-gw` → `api-gw`.
 */
function normalizeBeylaServiceName(raw: string): string {
  const parts = [...new Set(raw.split(';').map(s => s.trim()).filter(Boolean))];
  if (parts.length === 0) return raw;
  if (parts.length === 1) return parts[0] as string;
  return parts.join('/');
}

async function discoverViaBeyla(
  metricsUrl: string,
  orgId: string,
  existingAssets: DiscoveredAsset[],
  assets: DiscoveredAsset[],
  provider: DiscoveredAsset['provider'],
  identityMap?: AssetIdentityMap,
  region: string = 'on-premise',
): Promise<void> {
  const httpServices = await promQuery(
    metricsUrl, orgId,
    'count by (service_name, service_namespace) (http_server_request_duration_seconds_count)',
  );
  const grpcServices = await promQuery(
    metricsUrl, orgId,
    'count by (service_name, service_namespace) (rpc_server_duration_seconds_count)',
  );
  const dbServices = await promQuery(
    metricsUrl, orgId,
    'count by (service_name, service_namespace) (db_client_operation_duration_seconds_count)',
  );

  const serviceMap = new Map<string, { name: string; protocols: string[]; namespace: string | null }>();

  for (const results of [
    { data: httpServices, protocol: 'http' },
    { data: grpcServices, protocol: 'grpc' },
    { data: dbServices, protocol: 'database' },
  ]) {
    for (const r of results.data) {
      const rawName = r.metric.service_name;
      if (!rawName) continue;
      const name = normalizeBeylaServiceName(rawName);
      const ns = r.metric.service_namespace || null;
      const key = `${ns || ''}/${name}`;
      if (!serviceMap.has(key)) serviceMap.set(key, { name, protocols: [], namespace: ns });
      serviceMap.get(key)!.protocols.push(results.protocol);
    }
  }

  const existingNames = new Set([
    ...existingAssets.map(a => a.name.toLowerCase()),
    ...assets.map(a => a.name.toLowerCase()),
  ]);

  for (const [, svc] of serviceMap) {
    // In-tick name match (Beyla service vs K8s workload/any other asset
    // just pushed this tick) — keeps Beyla from shadowing an
    // already-discovered workload with the same name.
    if (existingNames.has(svc.name.toLowerCase())) continue;
    // Cross-tick identity-map match (Beyla service vs cloud-SDK serverless
    // container, Lambda, Cloud Run, App Service, Scaleway Function/
    // Container, DO App/Function). The cloud SDK's row is canonical; we
    // don't want to create a sibling beyla-svc:… row alongside it.
    if (identityMap?.has(assetFingerprint('compute', 'application_service', svc.name))) continue;

    assets.push(makeAsset({
      name: svc.name,
      provider,
      category: 'compute',
      resource_type: 'application_service',
      cloud_id: `beyla-svc:${orgId}:${svc.name}`,
      cloud_account_id: orgId,
      region,
      k8s_namespace: svc.namespace,
      metadata: {
        discovered_by: 'beyla',
        protocols: [...new Set(svc.protocols)].join(', '),
      },
    }));
  }
}
