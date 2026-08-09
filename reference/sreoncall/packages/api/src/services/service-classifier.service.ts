import type { ServiceClassification } from '../models/service.model';

export interface ClassificationInput {
  name: string;
  k8s_namespace: string | null;
  k8s_kind: string | null;
  resource_type: string;
  category: string;
}

// ── Known patterns (inverted: identify non-app, everything else is app) ──

const SYSTEM_NAMESPACES = new Set([
  'kube-system', 'kube-public', 'kube-node-lease',
]);

const MONITORING_PATTERNS = [
  'prometheus', 'grafana', 'alertmanager', 'thanos',
  'loki', 'mimir', 'tempo', 'pyroscope',
  'otel-collector', 'opentelemetry',
  'alloy', 'beyla', 'vector', 'fluentbit', 'fluentd', 'filebeat',
  'kube-state-metrics', 'node-exporter', 'blackbox-exporter',
  'sreoncall-agent',
];

const MONITORING_SUFFIXES = ['-exporter'];

const PLATFORM_PATTERNS = [
  'cert-manager', 'external-secrets', 'sealed-secrets',
  'calico', 'cilium', 'flannel', 'weave',
  'coredns', 'kube-dns',
  'csi-', 'kube-proxy', 'metrics-server',
  'ingress-nginx', 'ingress-controller', 'traefik', 'envoy', 'istio',
  'reloader', 'reflector',
  'vault', 'consul',
  'argocd', 'flux', 'tekton',
  'longhorn', 'rook-ceph',
  'external-dns',
];

function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((p) => name.includes(p));
}

function matchesSuffix(name: string, suffixes: string[]): boolean {
  return suffixes.some((s) => name.endsWith(s));
}

export function classifyAsset(input: ClassificationInput): ServiceClassification {
  const name = input.name.toLowerCase();
  const ns = input.k8s_namespace?.toLowerCase() ?? '';

  // 1. System namespaces
  if (ns && SYSTEM_NAMESPACES.has(ns)) return 'system';

  // 2. Monitoring tools
  if (matchesAny(name, MONITORING_PATTERNS) || matchesSuffix(name, MONITORING_SUFFIXES)) return 'monitoring';

  // 3. Platform tools
  if (matchesAny(name, PLATFORM_PATTERNS)) return 'platform';

  // 4. DaemonSets are typically infrastructure agents
  if (input.k8s_kind === 'DaemonSet') return 'infrastructure';

  // 5. Networking category
  if (input.category === 'networking') return 'infrastructure';

  // 6. Everything else is an application service
  return 'app';
}

export function inferServiceType(input: ClassificationInput): 'web' | 'api' | 'database' | 'queue' | 'cache' | 'worker' | 'storage' | 'other' {
  // Heroku dyno types have clear semantics
  if (input.resource_type === 'heroku_dyno') {
    const name = input.name.toLowerCase();
    if (name.includes('/web')) return 'web';
    if (name.includes('/worker') || name.includes('_worker')) return 'worker';
    return 'other';
  }
  if (input.resource_type === 'heroku_addon') {
    const name = input.name.toLowerCase();
    if (/postgres|mysql|mongo/.test(name)) return 'database';
    if (/redis|memcache/.test(name)) return 'cache';
    if (/kafka|rabbitmq|cloudamqp/.test(name)) return 'queue';
    return 'other';
  }
  const name = input.name.toLowerCase();

  if (/\b(api|gateway|proxy)\b/.test(name) || name.endsWith('-gw')) return 'api';
  if (/\b(postgres|mysql|mariadb|mongo|cockroach|cassandra|dynamodb|rdb)\b/.test(name)) return 'database';
  if (/\b(redis|memcached|valkey)\b/.test(name)) {
    // redis can be cache or database depending on usage, default cache
    return 'cache';
  }
  if (/\b(rabbitmq|kafka|nats|queue|sqs|pulsar|celery)\b/.test(name)) return 'queue';
  if (/\b(minio|s3|storage|bucket)\b/.test(name)) return 'storage';
  if (/\b(web|frontend|ui|portal|dashboard|app)\b/.test(name)) return 'web';
  if (/\b(worker|consumer|processor|job|cron|scheduler)\b/.test(name)) return 'worker';

  return 'other';
}
