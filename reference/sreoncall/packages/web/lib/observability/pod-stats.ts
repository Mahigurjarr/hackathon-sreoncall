export interface PodStatDef {
  key: 'cpu' | 'memory' | 'restarts';
  title: string;
  unit: 'cores' | 'bytes' | 'count';
  query: string;
}

export interface PodScope {
  cluster?: string;
  namespace?: string;
  service?: string;
  pod: string;
}

function sel(scope: PodScope): string {
  const parts: string[] = [];
  if (scope.cluster) parts.push(`cluster="${scope.cluster}"`);
  if (scope.namespace) parts.push(`namespace="${scope.namespace}"`);
  parts.push(`pod="${scope.pod}"`);
  return parts.join(',');
}

export function podStatQueries(scope: PodScope): PodStatDef[] {
  const s = sel(scope);
  return [
    { key: 'cpu', title: 'CPU', unit: 'cores', query: `sum(rate(container_cpu_usage_seconds_total{${s}}[5m]))` },
    { key: 'memory', title: 'Memory', unit: 'bytes', query: `sum(container_memory_working_set_bytes{${s}})` },
    { key: 'restarts', title: 'Restarts', unit: 'count', query: `max(kube_pod_container_status_restarts_total{${s}})` },
  ];
}
